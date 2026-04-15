"""
BOI Statement OCR Microservice
Runs locally on port 5001. Accepts an image, returns words with bounding boxes.

Install deps:  pip install flask easyocr pillow
Run:           python ocr_service.py
"""

from flask import Flask, request, jsonify
import easyocr
import io
from PIL import Image
import numpy as np

app = Flask(__name__)

# Initialise EasyOCR reader once at startup (downloads model ~100MB on first run)
print("Loading EasyOCR model...")
reader = easyocr.Reader(["en"], gpu=False)  # set gpu=True if you have a CUDA GPU
print("EasyOCR ready.")


@app.route("/ocr", methods=["POST"])
def ocr():
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    file = request.files["image"]
    image_bytes = file.read()

    # Open with PIL to get dimensions
    pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = pil_image.size
    img_array = np.array(pil_image)

    # Run EasyOCR
    # detail=1 returns bounding boxes, text, and confidence
    results = reader.readtext(img_array, detail=1, paragraph=False)

    words = []
    for (bbox, text, confidence) in results:
        # bbox is [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] (4 corners)
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        words.append({
            "text": text,
            "bbox": {
                "x0": int(min(xs)),
                "y0": int(min(ys)),
                "x1": int(max(xs)),
                "y1": int(max(ys)),
            },
            "confidence": round(confidence, 3),
        })

    return jsonify({"words": words, "width": width, "height": height})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)