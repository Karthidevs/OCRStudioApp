import sys
import json

def extract_tables(input_path, output_path):
    rows = []

    # Method 1 — pdfplumber (best for tables)
    try:
        import pdfplumber
        with pdfplumber.open(input_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                # Extract tables
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if row and len(row) >= 2:
                            field = str(row[0]).strip() if row[0] else ""
                            value = " | ".join([str(c).strip() for c in row[1:] if c and str(c).strip()])
                            skip = ["field", "dummy value", "value", "description", "sl.no", "s.no", "#", "none", ""]
                            if field and field.lower() not in skip and value:
                                rows.append({"field": field, "value": value})

                # Also extract key-value from text if no tables found
                if not rows:
                    text = page.extract_text()
                    if text:
                        for line in text.split("\n"):
                            line = line.strip()
                            if not line:
                                continue
                            # Multi-space separator
                            import re
                            parts = re.split(r'\s{3,}', line)
                            parts = [p.strip() for p in parts if p.strip()]
                            if len(parts) >= 2:
                                skip = ["field", "dummy value", "value", "description"]
                                if parts[0].lower() not in skip:
                                    rows.append({"field": parts[0], "value": " ".join(parts[1:])})
                            elif ":" in line:
                                colon_idx = line.index(":")
                                field = line[:colon_idx].strip()
                                value = line[colon_idx+1:].strip()
                                if field and value and len(field) < 60:
                                    rows.append({"field": field, "value": value})

        if rows:
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=2)
            print(f"pdfplumber: extracted {len(rows)} rows", file=sys.stderr)
            return

    except Exception as e:
        print(f"pdfplumber failed: {e}", file=sys.stderr)

    # Method 2 — pypdf text extraction
    try:
        import pypdf
        reader = pypdf.PdfReader(input_path)
        import re
        for page in reader.pages:
            text = page.extract_text()
            if not text:
                continue
            for line in text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                parts = re.split(r'\s{3,}', line)
                parts = [p.strip() for p in parts if p.strip()]
                if len(parts) >= 2:
                    skip = ["field", "dummy value", "value", "description"]
                    if parts[0].lower() not in skip:
                        rows.append({"field": parts[0], "value": " ".join(parts[1:])})
                elif ":" in line:
                    colon_idx = line.index(":")
                    field = line[:colon_idx].strip()
                    value = line[colon_idx+1:].strip()
                    if field and value and len(field) < 60:
                        rows.append({"field": field, "value": value})

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)
        print(f"pypdf: extracted {len(rows)} rows", file=sys.stderr)

    except Exception as e:
        print(f"pypdf failed: {e}", file=sys.stderr)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump([], f)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python extract_tables.py <input.pdf> <output.json>")
        sys.exit(1)
    extract_tables(sys.argv[1], sys.argv[2])
