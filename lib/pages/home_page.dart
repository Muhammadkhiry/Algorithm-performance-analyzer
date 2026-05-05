import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:fl_chart/fl_chart.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:screenshot/screenshot.dart';

class HomePage extends StatefulWidget {
  final VoidCallback onToggleTheme;

  const HomePage({super.key, required this.onToggleTheme});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final codeController = TextEditingController();
  final inputArrayController = TextEditingController();
  final screenshotController = ScreenshotController();

  bool loading = false;
  bool isManual = false;

  String best = "—";
  String avg = "—";
  String worst = "—";

  int confidence = 0;

  List<Map<String, dynamic>> sortedData = [];
  List<Map<String, dynamic>> reversedData = [];
  List<Map<String, dynamic>> randomData = [];

  double bestK = 0;
  double avgK = 0;
  double worstK = 0;
  double executionTime = 0;
  String explanation = "";

  final String baseUrl = "http://localhost:5000";

  // ================= QUICK BUTTONS =================
  void loadBubbleSort() {
    codeController.text = '''
(arr) => {
  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        let temp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = temp;
      }
    }
  }
  return arr;
}
''';
  }

  void loadMergeSort() {
    codeController.text = '''
(arr) => {
  function mergeSort(arr) {
    if (arr.length <= 1) return arr;

    const mid = Math.floor(arr.length / 2);
    const left = mergeSort(arr.slice(0, mid));
    const right = mergeSort(arr.slice(mid));

    const result = [];
    let i = 0, j = 0;

    while (i < left.length && j < right.length) {
      if (left[i] < right[j]) result.push(left[i++]);
      else result.push(right[j++]);
    }

    return result.concat(left.slice(i)).concat(right.slice(j));
  }

  return mergeSort(arr);
}
''';
  }

  void loadBinarySearch() {
    codeController.text = '''
(arr) => {
  let target = arr[Math.floor(arr.length / 2)];
  let left = 0, right = arr.length - 1;

  while (left <= right) {
    let mid = Math.floor((left + right) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) left = mid + 1;
    else right = mid - 1;
  }

  return -1;
}
''';
  }

  // ================= ANALYZE =================
  Future<void> analyze() async {
    if (loading || codeController.text.trim().isEmpty) return;

    if (isManual && inputArrayController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Enter input array in manual mode")),
      );
      return;
    }

    setState(() => loading = true);

    try {
      List<num> parsedArray = [];

      if (isManual) {
        final raw = inputArrayController.text
            .replaceAll("[", "")
            .replaceAll("]", "")
            .split(",")
            .map((e) => e.trim())
            .where((e) => e.isNotEmpty);

        parsedArray = raw.map((e) => num.parse(e)).toList();
      }

      final res = await http.post(
        Uri.parse("$baseUrl/analyze"),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode({
          "code": codeController.text,
          "mode": isManual ? "manual" : "auto",
          if (isManual) "inputArray": parsedArray,
        }),
      );

      if (!mounted) return;

      final data = jsonDecode(res.body);

      if (data["error"] != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(data["error"])));
        return;
      }

      final graph = data["chart"] ?? {};

      setState(() {
        best = data["bestCase"] ?? "—";
        avg = data["averageCase"] ?? "—";
        worst = data["worstCase"] ?? "—";

        sortedData = List<Map<String, dynamic>>.from(graph["sorted"] ?? []);
        reversedData = List<Map<String, dynamic>>.from(graph["reversed"] ?? []);
        randomData = List<Map<String, dynamic>>.from(graph["random"] ?? []);

        bestK = (data["debug"]?["slopes"]?["bestK"] ?? 0).toDouble();
        avgK = (data["debug"]?["slopes"]?["avgK"] ?? 0).toDouble();
        worstK = (data["debug"]?["slopes"]?["worstK"] ?? 0).toDouble();

        executionTime = (data["executionTimeMs"] ?? 0).toDouble();

        explanation = buildExplanation();

        confidence = (data["debug"]?["slopes"]?["bestK"] != null) ? 85 : 70;
      });

      if (isManual) {
        debugPrint("Manual output: ${data["output"]}");
      }
    } catch (e) {
      debugPrint("ERROR: $e");
    } finally {
      if (!mounted) return;
      setState(() => loading = false);
    }
  }

  // ================= EXPLANATION =================
  String buildExplanation() {
    if (best.contains("n^2") || worst.contains("n^2")) {
      return "Detected due to nested loops";
    }
    if (best.contains("log n")) {
      return "Detected logarithmic growth";
    }
    if (best == "O(n)") {
      return "Linear behavior detected";
    }
    return "Based on runtime + AST";
  }

  // ================= GRAPH =================
  List<FlSpot> spots(List data) {
    return data.map<FlSpot>((e) {
      final yRaw = (e["t"] ?? 0).toDouble();
      return FlSpot((e["n"]).toDouble(), log(max(yRaw, 0.0001) + 1));
    }).toList();
  }

  // ================= PDF (UNCHANGED) =================
  Future<void> exportPDF() async {
    final pdf = pw.Document();

    try {
      await Future.delayed(const Duration(milliseconds: 400));

      final Uint8List? img = await screenshotController.capture(
        delay: const Duration(milliseconds: 200),
      );

      final image = img != null ? pw.MemoryImage(img) : null;

      pdf.addPage(
        pw.Page(
          build: (_) => pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // ================= TITLE =================
              pw.Text(
                "Algorithm Performance Report",
                style: pw.TextStyle(
                  fontSize: 24,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),

              pw.SizedBox(height: 15),

              // ================= CODE =================
              pw.Text("1. Source Code", style: pw.TextStyle(fontSize: 18)),
              pw.Container(
                padding: const pw.EdgeInsets.all(8),
                margin: const pw.EdgeInsets.only(top: 5, bottom: 10),
                decoration: pw.BoxDecoration(border: pw.Border.all()),
                child: pw.Text(codeController.text),
              ),

              // ================= RESULTS =================
              pw.Text(
                "2. Complexity Results",
                style: pw.TextStyle(fontSize: 18),
              ),
              pw.Text("Best Case: $best"),
              pw.Text("Average Case: $avg"),
              pw.Text("Worst Case: $worst"),

              pw.SizedBox(height: 10),

              pw.Text("Confidence Score: $confidence%"),

              pw.SizedBox(height: 10),

              // ================= K VALUES =================
              pw.Text(
                "3. Growth Factors (k-values)",
                style: pw.TextStyle(fontSize: 18),
              ),
              pw.Text("Best k: ${bestK.toStringAsFixed(3)}"),
              pw.Text("Avg k: ${avgK.toStringAsFixed(3)}"),
              pw.Text("Worst k: ${worstK.toStringAsFixed(3)}"),

              pw.SizedBox(height: 10),

              // ================= EXECUTION TIME =================
              pw.Text("Execution Time: ${executionTime.toStringAsFixed(4)} ms"),

              pw.SizedBox(height: 10),

              // ================= EXPLANATION =================
              pw.Text(
                "4. Analysis Explanation",
                style: pw.TextStyle(fontSize: 18),
              ),
              pw.Text(explanation),

              pw.SizedBox(height: 15),

              // ================= GRAPH =================
              if (image != null) ...[
                pw.Text(
                  "5. Performance Graph",
                  style: pw.TextStyle(fontSize: 18),
                ),
                pw.SizedBox(height: 10),
                pw.Container(
                  height: 300,
                  child: pw.Image(image, fit: pw.BoxFit.contain),
                ),
              ] else ...[
                pw.Text(
                  "5. Performance Graph",
                  style: pw.TextStyle(fontSize: 18, color: PdfColors.red),
                ),
                pw.Text("Graph capture failed"),
              ],
            ],
          ),
        ),
      );

      await Printing.layoutPdf(onLayout: (_) => pdf.save());
    } catch (e) {
      debugPrint("PDF Export Error: $e");
    }
  }

  // ================= UI =================
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Algorithm Analyzer"),
        actions: [
          IconButton(
            icon: const Icon(Icons.brightness_6),
            onPressed: widget.onToggleTheme,
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: SingleChildScrollView(
          child: Column(
            children: [
              // MODE
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text("Auto"),
                  Switch(
                    value: isManual,
                    onChanged: (v) => setState(() => isManual = v),
                  ),
                  const Text("Manual"),
                ],
              ),

              const SizedBox(height: 10),

              // 🆕 BUTTONS
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    ElevatedButton(
                      onPressed: loadBubbleSort,
                      child: const Text("Bubble Sort"),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: loadMergeSort,
                      child: const Text("Merge Sort"),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: loadBinarySearch,
                      child: const Text("Binary Search"),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 10),

              // CODE (كما هو)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E1E),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: TextField(
                  controller: codeController,
                  maxLines: 7,
                  style: const TextStyle(
                    color: Colors.white,
                    fontFamily: "monospace",
                  ),
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    hintText: "// Write your algorithm here...",
                    hintStyle: TextStyle(color: Colors.grey),
                  ),
                ),
              ),

              const SizedBox(height: 10),

              ElevatedButton(
                onPressed: loading ? null : analyze,
                child: loading
                    ? const CircularProgressIndicator(strokeWidth: 2)
                    : const Text("Run"),
              ),
              ElevatedButton(
                onPressed: sortedData.isEmpty ? null : exportPDF,
                child: const Text("Export PDF"),
              ),

              const SizedBox(height: 10),

              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  chip("Best", best, Colors.green),
                  chip("Avg", avg, Colors.blue),
                  chip("Worst", worst, Colors.red),
                ],
              ),

              const SizedBox(height: 10),

              Text("Confidence: $confidence%"),

              // 🆕 k values + explanation
              Text(
                "k(best): ${bestK.toStringAsFixed(2)} | k(avg): ${avgK.toStringAsFixed(2)} | k(worst): ${worstK.toStringAsFixed(2)}",
              ),
              Text(explanation),

              if (isManual) ...[
                Text("Execution Time: ${executionTime.toStringAsFixed(4)} ms"),
                const SizedBox(height: 8),

                TextField(
                  controller: inputArrayController,
                  decoration: const InputDecoration(
                    labelText: "Input Array",
                    hintText: "1, 2, 3, 4",
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              const SizedBox(height: 10),

              Container(
                height: 400,
                child: Screenshot(
                  controller: screenshotController,
                  child: sortedData.isEmpty
                      ? const Center(child: Text("No data yet"))
                      : LineChart(
                          LineChartData(
                            titlesData: FlTitlesData(
                              bottomTitles: AxisTitles(
                                axisNameWidget: const Text("Input Size (n)"),
                              ),
                              leftTitles: AxisTitles(
                                axisNameWidget: const Text("log(Time)"),
                              ),
                            ),
                            minY: 0,
                            gridData: FlGridData(show: true),
                            borderData: FlBorderData(
                              show: true,
                              border: Border.all(color: Colors.grey),
                            ),
                            lineBarsData: [
                              line(spots(sortedData), Colors.green),
                              line(spots(reversedData), Colors.blue),
                              line(spots(randomData), Colors.red),
                            ],
                          ),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  LineChartBarData line(List<FlSpot> s, Color c) {
    return LineChartBarData(
      spots: s,
      isCurved: true,
      color: c,
      barWidth: 3,
      dotData: FlDotData(show: true),
    );
  }

  Widget chip(String t, String v, Color c) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: c.withOpacity(0.2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Text(t),
          Text(v, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget legend(String text, Color color) {
    return Row(
      children: [
        Container(width: 12, height: 12, color: color),
        const SizedBox(width: 5),
        Text(text),
      ],
    );
  }
}
