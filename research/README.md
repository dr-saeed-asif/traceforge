# Research evaluation

TraceForge evaluates two separate stages: claim extraction and deterministic verdict assignment. `evaluation.example.jsonl` is a small synthetic smoke-test dataset, not paper evidence.

Create a separate JSONL dataset for the study. Each row contains an immutable case ID, the agent's exact final response, prompt-scoped evidence, and independently annotated gold claims with verdicts. Keep natural agent runs separate from controlled fault-injection cases.

Export captured sessions into an annotation-ready file:

```powershell
npm run research:export -- research/annotation-natural.jsonl
```

The export contains final responses, redacted evidence, and run metadata. It excludes captured generated source code and configured API keys. Review final-response text for user-provided sensitive data before sharing it. Annotators fill `goldClaims`; keep annotator files separate until adjudication to avoid accidental agreement.

Run the local baseline:

```powershell
npm run research:evaluate -- research/evaluation.example.jsonl heuristic
```

Run local Ollama extraction after configuring `.env` and starting Ollama:

```powershell
npm run research:evaluate -- research/your-labelled-dataset.jsonl ollama
```

The command reports extraction precision, recall, F1, verdict accuracy, and the verdict confusion matrix. For the paper, use two independent annotators, record disagreements, report inter-rater agreement, freeze the dataset before the final run, and retain model identifiers, prompts, repository revisions, and raw traces.
