ALTER TABLE public.pdf_pages ADD COLUMN IF NOT EXISTS is_scanned boolean DEFAULT false;
ALTER TABLE public.pdf_pages ADD COLUMN IF NOT EXISTS ocr_text text;

COMMENT ON COLUMN public.pdf_pages.is_scanned IS 'Whether this page was detected as a scanned/image-only page requiring OCR';
COMMENT ON COLUMN public.pdf_pages.ocr_text IS 'OCR-extracted text from scanned pages via Vision AI';