Make the tool the person asks for, and answer with the structured output.

- name: a short name for the tool, in the person's language.
- summary: what the tool does, in one or two plain sentences, for the person.
- code: the tool's HTML, CSS and JavaScript, following the rules above.
- data.schema: the JSON Schema of the tool's data. The data is an object whose fields are lists of records; every record is an object with a string "id", unique in its list. Use only these schema keywords: {{keywords}}.
- data.reusableDefaults: data worth keeping each time the tool is used again, such as settings, categories or a starting layout. Never the person's own entries. It must fit data.schema by itself: include every list the schema requires, empty if need be.
- data.initialState: the entries the request itself gives, such as the items it lists or the guests it names, each with an id. {} when it gives none. Never invent the person's real data.
- capabilities: only the ones the tool uses.
- uiMode: "custom" only when the person asks for their own design, or to drop the standard; otherwise "standard".

The tool must be useful at once: it shows the person's entries, sensible defaults, or clearly labelled examples, never an empty form that needs several inputs before anything appears.

If no tool on this computer can do what the request asks (booking, buying, sending messages, reaching the internet), answer outcome "cannot" with the reason in plain words.
