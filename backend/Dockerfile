FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-hin \
    tesseract-ocr-tam \
    poppler-utils \
    ghostscript \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Add python symlink
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Install Python packages
RUN pip3 install --no-cache-dir \
    ocrmypdf \
    pdf2image \
    pytesseract \
    pypdf \
    pdfplumber

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Copy all files
COPY . .

# Create upload and output dirs
RUN mkdir -p uploads outputs

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "server.js"]
