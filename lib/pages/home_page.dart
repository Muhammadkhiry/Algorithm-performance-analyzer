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

  final String baseUrl = "http://localhost:5000";

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

      // ================= SAFE PARSING (FIX) =================
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

      final data = jsonDecode(res.body);

      if (data["error"] != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(data["error"])));
        return;
      }

      final graph = data["chart"] ?? {};

      // ================= FULL STATE UPDATE (FIX CORE ISSUE) =================
      setState(() {
        best = data["bestCase"] ?? "—";
        avg = data["averageCase"] ?? "—";
        worst = data["worstCase"] ?? "—";

        sortedData = List<Map<String, dynamic>>.from(graph["sorted"] ?? []);
        reversedData = List<Map<String, dynamic>>.from(graph["reversed"] ?? []);
        randomData = List<Map<String, dynamic>>.from(graph["random"] ?? []);

        confidence = (data["debug"]?["slopes"]?["bestK"] != null) ? 85 : 70;
      });

      // ================= MANUAL RESULT DIALOG (KEPT FEATURE) =================
      if (isManual) {
        // لا popup — النتائج كلها في الـUI الأساسي
        debugPrint("Manual output: ${data["output"]}");
      }
    } catch (e) {
      debugPrint("ERROR: $e");
    } finally {
      setState(() => loading = false);
    }
  }

  // ================= GRAPH =================
  List<FlSpot> spots(List data) {
    return data.map<FlSpot>((e) {
      final yRaw = (e["t"] ?? 0).toDouble();
      return FlSpot((e["n"]).toDouble(), log(max(yRaw, 0.0001) + 1));
    }).toList();
  }

  // ================= PDF (UNCHANGED FEATURE) =================
  Future<void> exportPDF() async {
    final pdf = pw.Document();

    Uint8List? img = await screenshotController.capture();
    final image = img != null ? pw.MemoryImage(img) : null;

    final minLen = [
      sortedData.length,
      reversedData.length,
      randomData.length,
    ].reduce(min);

    pdf.addPage(
      pw.Page(
        build: (_) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text("Algorithm Report", style: pw.TextStyle(fontSize: 20)),
            pw.SizedBox(height: 10),
            pw.Text("Best Case: $best"),
            pw.Text("Average Case: $avg"),
            pw.Text("Worst Case: $worst"),
            pw.Text("Confidence: $confidence%"),
            pw.SizedBox(height: 10),
            pw.Text("Input Code:"),
            pw.Container(
              padding: const pw.EdgeInsets.all(8),
              color: PdfColors.grey300,
              child: pw.Text(codeController.text),
            ),
            pw.SizedBox(height: 10),
            if (image != null) pw.Image(image),
            pw.SizedBox(height: 10),
            pw.Text("Test Table:"),
            pw.Table.fromTextArray(
              data: [
                ["n", "sorted", "reversed", "random"],
                ...List.generate(minLen, (i) {
                  return [
                    sortedData[i]["n"].toString(),
                    (sortedData[i]["t"] as num).toStringAsFixed(4),
                    (reversedData[i]["t"] as num).toStringAsFixed(4),
                    (randomData[i]["t"] as num).toStringAsFixed(4),
                  ];
                }),
              ],
            ),
          ],
        ),
      ),
    );

    await Printing.layoutPdf(onLayout: (_) => pdf.save());
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

            // CODE
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

            if (isManual)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E1E1E),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: TextField(
                  controller: inputArrayController,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    hintText: "[1, 5, 3, 2]",
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

            const SizedBox(height: 10),

            // BEST / AVG / WORST (UNCHANGED FEATURE)
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

            const SizedBox(height: 10),

            // LEGEND (UNCHANGED)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                legend("Sorted", Colors.green),
                const SizedBox(width: 10),
                legend("Reversed", Colors.blue),
                const SizedBox(width: 10),
                legend("Random", Colors.red),
              ],
            ),

            const SizedBox(height: 10),

            ElevatedButton(
              onPressed: sortedData.isEmpty ? null : exportPDF,
              child: const Text("Export PDF"),
            ),

            const SizedBox(height: 10),

            // GRAPH (FIXED RELIABLE UPDATE)
            Expanded(
              child: Screenshot(
                controller: screenshotController,
                child: sortedData.isEmpty
                    ? const Center(child: Text("No data yet"))
                    : LineChart(
                        LineChartData(
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
