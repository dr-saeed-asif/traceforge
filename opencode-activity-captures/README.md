# OpenCode Activity Captures

This root-level folder is maintained by the active TraceForge integration in `opencode-works`.

Every captured OpenCode prompt receives its own subfolder:

```text
<run-id>--<prompt-sequence>--<prompt-slug>/
├── README.md
├── prompt.json
├── summary.json
├── events/
│   └── <sequence>--<event-type>--<event-id>.json
└── worked-files/
    └── <sequence>--<filename>.json
```

The root `index.json` lists all captured prompt folders. Runtime evidence is excluded from Git because it may contain sensitive engineering activity.
