import sys
import os

def ocr_pdf(input_path, output_base, language="eng"):
    text_parts = []
    success = False

    # Method 1: pypdf (best for digital PDFs)
    try:
        import pypdf
        reader = pypdf.PdfReader(input_path)
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text and text.strip():
                text_parts.append(f"--- Page {i+1} ---\n{text}")
        if text_parts:
            success = True
            print(f"pypdf: extracted {len(text_parts)} pages", file=sys.stderr)
    except Exception as e:
        print(f"pypdf failed: {e}", file=sys.stderr)

    # Method 2: pdfplumber (better table extraction)
    if not success:
        try:
            import pdfplumber
            with pdfplumber.open(input_path) as pdf:
                for i, page in enumerate(pdf.pages):
                    text = page.extract_text()
                    if text and text.strip():
                        text_parts.append(f"--- Page {i+1} ---\n{text}")
            if text_parts:
                success = True
                print(f"pdfplumber: extracted {len(text_parts)} pages", file=sys.stderr)
        except Exception as e:
            print(f"pdfplumber failed: {e}", file=sys.stderr)

    # Method 3: pdf2image + pytesseract (for scanned PDFs)
    if not success:
        try:
            from pdf2image import convert_from_path
            import pytesseract
            pages = convert_from_path(input_path, dpi=300)
            for i, page in enumerate(pages):
                print(f"OCR page {i+1}/{len(pages)}...", file=sys.stderr)
                text = pytesseract.image_to_string(page, lang=language)
                if text.strip():
                    text_parts.append(f"--- Page {i+1} ---\n{text}")
            if text_parts:
                success = True
                print(f"pdf2image+tesseract: extracted {len(text_parts)} pages", file=sys.stderr)
        except Exception as e:
            print(f"pdf2image failed: {e}", file=sys.stderr)

    if not text_parts:
        text_parts = ["No text could be extracted from this PDF. It may be encrypted or image-based without OCR support."]

    full_text = "\n\n".join(text_parts)
    output_path = f"{output_base}.txt"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(full_text)

    print(f"Done! Extracted {len(full_text)} characters", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python pdf_ocr.py <input.pdf> <output_base> [language]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_base = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else "eng"

    ocr_pdf(input_path, output_base, language)
