import sys
import os

def ocr_pdf(input_path, output_base, language="eng"):
    text_parts = []
    
    try:
        # Method 1: Try pdf2image + pytesseract
        from pdf2image import convert_from_path
        import pytesseract
        
        print(f"Converting PDF pages to images...", file=sys.stderr)
        pages = convert_from_path(input_path, dpi=300)
        
        for i, page in enumerate(pages):
            print(f"OCR page {i+1}/{len(pages)}...", file=sys.stderr)
            text = pytesseract.image_to_string(page, lang=language)
            text_parts.append(f"--- Page {i+1} ---\n{text}")
        
        full_text = "\n\n".join(text_parts)
        
    except ImportError:
        try:
            # Method 2: Try pypdf for digital PDFs
            import pypdf
            reader = pypdf.PdfReader(input_path)
            for i, page in enumerate(reader.pages):
                text = page.extract_text()
                if text:
                    text_parts.append(f"--- Page {i+1} ---\n{text}")
            full_text = "\n\n".join(text_parts)
        except ImportError:
            # Method 3: Try pdfplumber
            import pdfplumber
            with pdfplumber.open(input_path) as pdf:
                for i, page in enumerate(pdf.pages):
                    text = page.extract_text()
                    if text:
                        text_parts.append(f"--- Page {i+1} ---\n{text}")
            full_text = "\n\n".join(text_parts)

    # Write output
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
