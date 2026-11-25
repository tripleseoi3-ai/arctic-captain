$ErrorActionPreference = "Stop"

$rawDir = "C:\Users\user2\.gemini\antigravity\scratch\arctic-captain\data\raw"
$outJson = "C:\Users\user2\.gemini\antigravity\scratch\arctic-captain\data\sea_ice_data.json"
$outJs = "C:\Users\user2\.gemini\antigravity\scratch\arctic-captain\data\sea_ice_data.js"

$csharp = @"
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

public class SeaIceModeler
{
    public class ObsPoint
    {
        public int Year;
        public int Month;
        public double Extent;
        public double Area;
        public string Dataset;
        public bool Interpolated;
    }

    public class SarimaFit
    {
        public double C;
        public double Phi1;
        public double Theta12;
        public double Sigma;
    }

    public static double[] FitBaseline(double[] y, int startMonth, out double[] monthMeans, out double slope, out double meanT)
    {
        int n = y.Length;
        meanT = (n - 1) / 2.0;
        // Estimate global linear trend slope on seasonally-centered series
        double[] rawMonthMean = new double[12];
        int[] rawMonthCnt = new int[12];
        for (int i = 0; i < n; i++)
        {
            int m = (startMonth - 1 + i) % 12;
            rawMonthMean[m] += y[i];
            rawMonthCnt[m]++;
        }
        for (int m = 0; m < 12; m++) rawMonthMean[m] /= Math.Max(1, rawMonthCnt[m]);

        // Joint OLS for y_t = mu_{m(t)} + slope * (t - meanT)
        // Iterative Gauss-Seidel (converges to exact OLS in ~20 iterations)
        monthMeans = (double[])rawMonthMean.Clone();
        slope = 0.0;
        for (int iter = 0; iter < 50; iter++)
        {
            double num = 0.0, den = 0.0;
            for (int i = 0; i < n; i++)
            {
                int m = (startMonth - 1 + i) % 12;
                double dt = i - meanT;
                num += dt * (y[i] - monthMeans[m]);
                den += dt * dt;
            }
            slope = num / den;
            for (int m = 0; m < 12; m++) { monthMeans[m] = 0.0; rawMonthCnt[m] = 0; }
            for (int i = 0; i < n; i++)
            {
                int m = (startMonth - 1 + i) % 12;
                monthMeans[m] += y[i] - slope * (i - meanT);
                rawMonthCnt[m]++;
            }
            for (int m = 0; m < 12; m++) monthMeans[m] /= Math.Max(1, rawMonthCnt[m]);
        }

        double[] fitted = new double[n];
        for (int i = 0; i < n; i++)
        {
            int m = (startMonth - 1 + i) % 12;
            fitted[i] = monthMeans[m] + slope * (i - meanT);
        }
        return fitted;
    }

    public static double[] ForecastBaseline(int nTrain, int startMonth, double[] monthMeans, double slope, double meanT, int horizon)
    {
        double[] fc = new double[horizon];
        for (int h = 0; h < horizon; h++)
        {
            int idx = nTrain + h;
            int m = (startMonth - 1 + idx) % 12;
            fc[h] = Math.Max(0.1, monthMeans[m] + slope * (idx - meanT));
        }
        return fc;
    }

    // SARIMA(1,0,0)(0,1,1)_12 with drift:
    // z_t = y_t - y_{t-12}
    // (z_t - c) - phi1 * (z_{t-1} - c) = e_t + theta12 * e_{t-12}
    private static double ComputeSarimaSSE(double[] z, double c, double phi1, double theta12, out double[] eps)
    {
        int nz = z.Length;
        eps = new double[nz];
        double sse = 0.0;
        for (int t = 0; t < nz; t++)
        {
            double zPrev = (t >= 1) ? (z[t - 1] - c) : 0.0;
            double ePrev12 = (t >= 12) ? eps[t - 12] : 0.0;
            double e = (z[t] - c) - phi1 * zPrev - theta12 * ePrev12;
            eps[t] = e;
            if (t >= 12) sse += e * e;
        }
        return sse;
    }

    public static SarimaFit FitSarima(double[] y)
    {
        int n = y.Length;
        int nz = n - 12;
        double[] z = new double[nz];
        double meanZ = 0.0;
        for (int t = 0; t < nz; t++)
        {
            z[t] = y[t + 12] - y[t];
            meanZ += z[t];
        }
        meanZ /= nz;

        // Coarse grid + coordinate refinement over (c, phi1, theta12)
        double bestSSE = double.PositiveInfinity;
        double bestC = meanZ, bestPhi = 0.5, bestTheta = -0.6;
        double[] tmpEps;

        for (double phi = -0.2; phi <= 0.9; phi += 0.1)
        {
            for (double th = -0.95; th <= 0.2; th += 0.1)
            {
                double sse = ComputeSarimaSSE(z, meanZ, phi, th, out tmpEps);
                if (sse < bestSSE) { bestSSE = sse; bestPhi = phi; bestTheta = th; }
            }
        }

        // Fine coordinate search
        double stepC = 0.02, stepP = 0.05, stepT = 0.05;
        for (int round = 0; round < 20; round++)
        {
            bool improved = true;
            while (improved)
            {
                improved = false;
                foreach (double dc in new[] { -stepC, stepC })
                {
                    double nc = bestC + dc;
                    double sse = ComputeSarimaSSE(z, nc, bestPhi, bestTheta, out tmpEps);
                    if (sse < bestSSE) { bestSSE = sse; bestC = nc; improved = true; }
                }
                foreach (double dp in new[] { -stepP, stepP })
                {
                    double np = bestPhi + dp;
                    if (np <= -0.95 || np >= 0.95) continue;
                    double sse = ComputeSarimaSSE(z, bestC, np, bestTheta, out tmpEps);
                    if (sse < bestSSE) { bestSSE = sse; bestPhi = np; improved = true; }
                }
                foreach (double dt in new[] { -stepT, stepT })
                {
                    double nt = bestTheta + dt;
                    if (nt <= -0.98 || nt >= 0.95) continue;
                    double sse = ComputeSarimaSSE(z, bestC, bestPhi, nt, out tmpEps);
                    if (sse < bestSSE) { bestSSE = sse; bestTheta = nt; improved = true; }
                }
            }
            stepC *= 0.5; stepP *= 0.5; stepT *= 0.5;
        }

        double[] finalEps;
        double finalSSE = ComputeSarimaSSE(z, bestC, bestPhi, bestTheta, out finalEps);
        int df = Math.Max(1, (nz - 12) - 3);
        return new SarimaFit
        {
            C = bestC,
            Phi1 = bestPhi,
            Theta12 = bestTheta,
            Sigma = Math.Sqrt(finalSSE / df)
        };
    }

    public static void ForecastSarima(double[] y, SarimaFit fit, int horizon, out double[] meanFc, out double[] lower95, out double[] upper95)
    {
        int n = y.Length;
        int nz = n - 12;
        double[] z = new double[nz];
        for (int t = 0; t < nz; t++) z[t] = y[t + 12] - y[t];
        double[] eps;
        ComputeSarimaSSE(z, fit.C, fit.Phi1, fit.Theta12, out eps);

        double[] yExt = new double[n + horizon];
        Array.Copy(y, yExt, n);
        double[] zExt = new double[nz + horizon];
        Array.Copy(z, zExt, nz);
        double[] eExt = new double[nz + horizon];
        Array.Copy(eps, eExt, nz);

        // Compute exact MA(infinity) psi weights for (1 - phi1 B)(1 - B^12) psi(B) = 1 + theta12 B^12
        // => psi_k = phi1 * psi_{k-1} + psi_{k-12} - phi1 * psi_{k-13} + (k==12 ? theta12 : 0)
        double[] psi = new double[horizon];
        psi[0] = 1.0;
        for (int k = 1; k < horizon; k++)
        {
            double val = fit.Phi1 * psi[k - 1];
            if (k >= 12) val += psi[k - 12];
            if (k >= 13) val -= fit.Phi1 * psi[k - 13];
            if (k == 12) val += fit.Theta12;
            psi[k] = val;
        }

        meanFc = new double[horizon];
        lower95 = new double[horizon];
        upper95 = new double[horizon];

        double cumPsiSq = 0.0;
        for (int h = 0; h < horizon; h++)
        {
            int zIdx = nz + h;
            double zHat = fit.C + fit.Phi1 * (zExt[zIdx - 1] - fit.C) + fit.Theta12 * eExt[zIdx - 12];
            zExt[zIdx] = zHat;
            eExt[zIdx] = 0.0;
            double yHat = yExt[n + h - 12] + zHat;
            yExt[n + h] = yHat;

            cumPsiSq += psi[h] * psi[h];
            double se = fit.Sigma * Math.Sqrt(cumPsiSq);
            double clamped = Math.Max(0.1, yHat);
            meanFc[h] = clamped;
            lower95[h] = Math.Max(0.0, clamped - 1.96 * se);
            upper95[h] = clamped + 1.96 * se;
        }
    }

    public static string RunAll(string rawDir)
    {
        var rawMap = new Dictionary<int, ObsPoint>();
        for (int m = 1; m <= 12; m++)
        {
            string path = Path.Combine(rawDir, string.Format("N_{0:D2}_extent_v4.0.csv", m));
            string[] lines = File.ReadAllLines(path);
            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (string.IsNullOrEmpty(line)) continue;
                string[] cols = line.Split(',');
                if (cols.Length < 6) continue;
                int yr = int.Parse(cols[0].Trim(), CultureInfo.InvariantCulture);
                int mo = int.Parse(cols[1].Trim(), CultureInfo.InvariantCulture);
                if (yr < 1979) continue; // Start cleanly from 1979-01
                string ds = cols[2].Trim();
                double ext = double.Parse(cols[4].Trim(), CultureInfo.InvariantCulture);
                double area = double.Parse(cols[5].Trim(), CultureInfo.InvariantCulture);
                int key = yr * 100 + mo;
                rawMap[key] = new ObsPoint { Year = yr, Month = mo, Extent = ext, Area = area, Dataset = ds, Interpolated = (ext < 0) };
            }
        }

        // Determine contiguous observed range starting at 1979-01
        int maxKey = rawMap.Keys.Max();
        int maxYear = maxKey / 100;
        int maxMonth = maxKey % 100;

        var series = new List<ObsPoint>();
        int curY = 1979, curM = 1;
        while (curY < maxYear || (curY == maxYear && curM <= maxMonth))
        {
            int key = curY * 100 + curM;
            ObsPoint p;
            if (rawMap.TryGetValue(key, out p) && p.Extent >= 0)
            {
                series.Add(p);
            }
            else
            {
                // Interpolate using same-month previous & next year observed values
                double prevVal = -1, nextVal = -1;
                for (int dy = 1; dy <= 3 && prevVal < 0; dy++)
                {
                    ObsPoint q;
                    if (rawMap.TryGetValue((curY - dy) * 100 + curM, out q) && q.Extent >= 0) prevVal = q.Extent;
                }
                for (int dy = 1; dy <= 3 && nextVal < 0; dy++)
                {
                    ObsPoint q;
                    if (rawMap.TryGetValue((curY + dy) * 100 + curM, out q) && q.Extent >= 0) nextVal = q.Extent;
                }
                double est = (prevVal >= 0 && nextVal >= 0) ? (prevVal + nextVal) / 2.0 : (prevVal >= 0 ? prevVal : nextVal);
                series.Add(new ObsPoint { Year = curY, Month = curM, Extent = Math.Round(est, 2), Area = -1, Dataset = "interpolated", Interpolated = true });
            }
            curM++;
            if (curM > 12) { curM = 1; curY++; }
        }

        double[] yAll = series.Select(p => p.Extent).ToArray();

        // Holdout validation: Train 1979-01..2020-12 (504 months), Test 2021-01..2025-12 (60 months)
        int trainEndIdx = series.FindIndex(p => p.Year == 2021 && p.Month == 1);
        int testEndIdx = series.FindIndex(p => p.Year == 2026 && p.Month == 1);
        if (testEndIdx < 0) testEndIdx = series.Count;
        int nTest = testEndIdx - trainEndIdx;

        double[] yTrain = yAll.Take(trainEndIdx).ToArray();
        double[] yTest = yAll.Skip(trainEndIdx).Take(nTest).ToArray();

        double[] bmVal; double slopeVal; double meanTVal;
        FitBaseline(yTrain, 1, out bmVal, out slopeVal, out meanTVal);
        double[] baseValFc = ForecastBaseline(yTrain.Length, 1, bmVal, slopeVal, meanTVal, nTest);

        SarimaFit sarVal = FitSarima(yTrain);
        double[] sarValFc, sarValLo, sarValHi;
        ForecastSarima(yTrain, sarVal, nTest, out sarValFc, out sarValLo, out sarValHi);

        double baseMAE = 0, baseMSE = 0, sarMAE = 0, sarMSE = 0;
        for (int i = 0; i < nTest; i++)
        {
            double eb = Math.Abs(yTest[i] - baseValFc[i]);
            double es = Math.Abs(yTest[i] - sarValFc[i]);
            baseMAE += eb; baseMSE += eb * eb;
            sarMAE += es; sarMSE += es * es;
        }
        baseMAE /= nTest; double baseRMSE = Math.Sqrt(baseMSE / nTest);
        sarMAE /= nTest; double sarRMSE = Math.Sqrt(sarMSE / nTest);

        // Full fit on all observed data -> Forecast through 2035-12
        int targetEndYear = 2035;
        int horizon = (targetEndYear - maxYear) * 12 + (12 - maxMonth);

        double[] bmFull; double slopeFull; double meanTFull;
        FitBaseline(yAll, 1, out bmFull, out slopeFull, out meanTFull);
        double[] baseFc = ForecastBaseline(yAll.Length, 1, bmFull, slopeFull, meanTFull, horizon);

        SarimaFit sarFull = FitSarima(yAll);
        double[] sarFc, sarLo, sarHi;
        ForecastSarima(yAll, sarFull, horizon, out sarFc, out sarLo, out sarHi);

        // Build JSON cleanly
        var sb = new StringBuilder();
        var ci = CultureInfo.InvariantCulture;
        sb.AppendLine("{");
        sb.AppendLine("  \"meta\": {");
        sb.AppendLine("    \"source\": \"NSIDC Sea Ice Index v4.0 (G02135, Northern Hemisphere Monthly Extent)\",");
        sb.AppendLine("    \"sourceUrl\": \"https://nsidc.org/data/g02135/versions/4\",");
        sb.AppendLine("    \"unit\": \"million km^2\",");
        sb.AppendLine(string.Format(ci, "    \"observedStart\": \"1979-01\","));
        sb.AppendLine(string.Format(ci, "    \"observedEnd\": \"{0}-{1:D2}\",", maxYear, maxMonth));
        sb.AppendLine(string.Format(ci, "    \"forecastEnd\": \"{0}-12\",", targetEndYear));
        sb.AppendLine(string.Format(ci, "    \"observedMonths\": {0},", series.Count));
        sb.AppendLine(string.Format(ci, "    \"interpolatedMonths\": [{0}],", string.Join(", ", series.Where(p => p.Interpolated).Select(p => "\"" + p.Year + "-" + p.Month.ToString("D2") + "\""))));
        sb.AppendLine("    \"models\": {");
        sb.AppendLine("      \"baseline\": {");
        sb.AppendLine("        \"name\": \"기준선 (월별 평균 + 선형 추세)\",");
        sb.AppendLine(string.Format(ci, "        \"annualSlope\": {0:F4},", slopeFull * 12.0));
        sb.AppendLine(string.Format(ci, "        \"valPeriod\": \"2021-01 ~ 2025-12 ({0}개월)\",", nTest));
        sb.AppendLine(string.Format(ci, "        \"mae\": {0:F3},", baseMAE));
        sb.AppendLine(string.Format(ci, "        \"rmse\": {0:F3}", baseRMSE));
        sb.AppendLine("      },");
        sb.AppendLine("      \"sarima\": {");
        sb.AppendLine("        \"name\": \"SARIMA(1,0,0)(0,1,1)12 + Drift\",");
        sb.AppendLine(string.Format(ci, "        \"drift\": {0:F4},", sarFull.C));
        sb.AppendLine(string.Format(ci, "        \"phi1\": {0:F4},", sarFull.Phi1));
        sb.AppendLine(string.Format(ci, "        \"theta12\": {0:F4},", sarFull.Theta12));
        sb.AppendLine(string.Format(ci, "        \"sigma\": {0:F4},", sarFull.Sigma));
        sb.AppendLine(string.Format(ci, "        \"valPeriod\": \"2021-01 ~ 2025-12 ({0}개월)\",", nTest));
        sb.AppendLine(string.Format(ci, "        \"mae\": {0:F3},", sarMAE));
        sb.AppendLine(string.Format(ci, "        \"rmse\": {0:F3}", sarRMSE));
        sb.AppendLine("      }");
        sb.AppendLine("    }");
        sb.AppendLine("  },");

        // Group records by year -> array of 12 month objects
        sb.AppendLine("  \"years\": {");
        var byYear = new Dictionary<int, string[]>();
        for (int yr = 1979; yr <= targetEndYear; yr++) byYear[yr] = new string[12];

        foreach (var p in series)
        {
            byYear[p.Year][p.Month - 1] = string.Format(ci,
                "{{ \"m\": {0}, \"type\": \"obs\", \"extent\": {1:F2}, \"interp\": {2} }}",
                p.Month, p.Extent, p.Interpolated ? "true" : "false");
        }

        int fy = maxYear, fm = maxMonth;
        for (int h = 0; h < horizon; h++)
        {
            fm++;
            if (fm > 12) { fm = 1; fy++; }
            byYear[fy][fm - 1] = string.Format(ci,
                "{{ \"m\": {0}, \"type\": \"fc\", \"baseline\": {1:F2}, \"sarima\": {2:F2}, \"lo95\": {3:F2}, \"hi95\": {4:F2} }}",
                fm, baseFc[h], sarFc[h], sarLo[h], sarHi[h]);
        }

        for (int yr = 1979; yr <= targetEndYear; yr++)
        {
            string comma = (yr < targetEndYear) ? "," : "";
            sb.AppendLine(string.Format(ci, "    \"{0}\": [ {1} ]{2}", yr, string.Join(", ", byYear[yr]), comma));
        }

        sb.AppendLine("  }");
        sb.AppendLine("}");
        return sb.ToString();
    }
}
"@

Add-Type -TypeDefinition $csharp -Language CSharp
$json = [SeaIceModeler]::RunAll($rawDir)
[System.IO.File]::WriteAllText($outJson, $json, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($outJs, "window.ARCTIC_DATA = " + $json + ";`n", [System.Text.UTF8Encoding]::new($false))

$parsed = $json | ConvertFrom-Json
Write-Output "=== NSIDC + Model Summary ==="
Write-Output ("Observed: " + $parsed.meta.observedStart + " ~ " + $parsed.meta.observedEnd + " (" + $parsed.meta.observedMonths + " months)")
Write-Output ("Forecast end: " + $parsed.meta.forecastEnd)
Write-Output ("Interpolated: " + ($parsed.meta.interpolatedMonths -join ", "))
Write-Output ("Baseline MAE=" + $parsed.meta.models.baseline.mae + " RMSE=" + $parsed.meta.models.baseline.rmse + " Slope/yr=" + $parsed.meta.models.baseline.annualSlope)
Write-Output ("SARIMA   MAE=" + $parsed.meta.models.sarima.mae + " RMSE=" + $parsed.meta.models.sarima.rmse + " drift=" + $parsed.meta.models.sarima.drift + " phi1=" + $parsed.meta.models.sarima.phi1 + " theta12=" + $parsed.meta.models.sarima.theta12)
Write-Output ("Sample 1985 Sep: " + ($parsed.years."1985"[8] | ConvertTo-Json -Compress))
Write-Output ("Sample 2012 Sep: " + ($parsed.years."2012"[8] | ConvertTo-Json -Compress))
Write-Output ("Sample 2024 Sep: " + ($parsed.years."2024"[8] | ConvertTo-Json -Compress))
Write-Output ("Sample 2030 Sep: " + ($parsed.years."2030"[8] | ConvertTo-Json -Compress))
Write-Output ("Sample 2035 Sep: " + ($parsed.years."2035"[8] | ConvertTo-Json -Compress))
