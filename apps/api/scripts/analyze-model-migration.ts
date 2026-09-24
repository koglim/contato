import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelMigrationAnalysisContext } from "./evaluate-model-migration.js";
import { analyzeRows, loadCompleteCheckpoint, writeAnalysisReports } from "./model-migration-analysis.js";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Offline analysis takes no CLI arguments");
  const { checkpointPath, checkpointMetadata, checkpointPlan } = modelMigrationAnalysisContext;
  const rows = loadCompleteCheckpoint(checkpointPath, checkpointMetadata, checkpointPlan);
  const report = analyzeRows(rows, checkpointMetadata);
  writeAnalysisReports(dirname(checkpointPath), report);
  console.log(JSON.stringify({ mode: report.mode, model_calls: 0, calls: report.calls,
    json: "model-migration-v1-analysis.json", markdown: "model-migration-v1-analysis.md" }));
}
