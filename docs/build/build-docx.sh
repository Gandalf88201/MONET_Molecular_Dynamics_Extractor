#!/usr/bin/env bash
# Rebuild docs/md-analysis-workflow.docx from the Markdown master (needs pandoc and Graphviz `dot`).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docs="$(dirname "$here")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

dot -Tpng "$here/workflow-flow.dot" -o "$work/flow.png"
# Word cannot render Mermaid: replace the flowchart block with the Graphviz picture.
python3 - "$docs/md-analysis-workflow.md" "$work" <<'EOF'
import re, sys
source, work = sys.argv[1], sys.argv[2]
text = open(source, encoding='utf-8').read()
figure = (f'![Recommended analysis workflow. Left branch: full-resolution dynamics; right branch: decorrelated subset. '
          f'Node numbers are workflow steps.]({work}/flow.png){{width=5.2in}}')
text = re.sub(r'```mermaid.*?```', lambda _: figure, text, flags=re.S)
text = text.replace('| | |\n| --- | --- |', '| Item | Detail |\n| --- | --- |', 1)
open(f'{work}/pre.md', 'w', encoding='utf-8').write(text)
EOF
pandoc "$work/pre.md" -f markdown+tex_math_dollars+task_lists+pipe_tables \
  -o "$work/out.docx" --shift-heading-level-by=-1 --toc --toc-depth=2 \
  --reference-doc="$here/reference.docx" -M toc-title="Contents" \
  -M subtitle="A living document of MONET"

# Ask Word to refresh the table of contents when the file is opened.
mkdir "$work/x" && (cd "$work/x" && unzip -q ../out.docx)
python3 - "$work/x/word/settings.xml" <<'EOF'
import sys
path = sys.argv[1]
s = open(path, encoding='utf-8').read()
if 'updateFields' not in s:
    s = s.replace('<w:footnotePr>', '<w:updateFields w:val="true"/><w:footnotePr>', 1)
open(path, 'w', encoding='utf-8').write(s)
EOF
rm -f "$docs/md-analysis-workflow.docx"
(cd "$work/x" && zip -qXr "$docs/md-analysis-workflow.docx" .)
echo "Wrote $docs/md-analysis-workflow.docx"
