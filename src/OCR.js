import React, { useState } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';

const OCR = () => {
    const [file, setFile] = useState(null);
    const [ocrResult, setOCRResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const onDrop = (acceptedFiles) => {
        console.log("Files dropped:", acceptedFiles);  // Debug log to check file drop
        setFile(acceptedFiles[0]);
    };

    const handleFileUpload = async () => {
        if (!file) return;

        console.log("File selected for upload:", file);  // Log selected file
        setIsLoading(true);

        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onloadend = async () => {
            const base64data = reader.result.split(',')[1];
            console.log("Base64 data generated:", base64data);  // Log Base64 data

            if (!base64data) {
                console.error("Error: No base64 data generated.");
                setIsLoading(false);
                return;
            }

            const apiKey = process.env.REACT_APP_API_KEY || 'your-api-key-here';

            try {
                const response = await axios.post(
                    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
                    {
                        requests: [
                            {
                                image: { content: base64data },
                                features: [{ type: 'TEXT_DETECTION' }]
                            }
                        ]
                    },
                    { headers: { 'Content-Type': 'application/json' } }
                );

                console.log("API Response:", response.data);  // Log API response
                const textAnnotations = response.data.responses[0]?.fullTextAnnotation?.text || "No text found.";
                setOCRResult(textAnnotations);
            } catch (error) {
                console.error("Error during OCR API request:", error);  // Log API request errors
            } finally {
                setIsLoading(false);
            }
        };

        reader.onerror = (error) => {
            console.error("Error reading file:", error);  // Log FileReader errors
            setIsLoading(false);
        };
    };

    const { getRootProps, getInputProps } = useDropzone({ onDrop });

    return (
        <div style={{ padding: '20px' }}>
            <h1>Google Vision OCR</h1>
            <div
                {...getRootProps()}
                style={{
                    border: '2px dashed #cccccc',
                    padding: '20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    marginBottom: '20px'
                }}
            >
                <input {...getInputProps()} accept=".jpg,.jpeg,.png,.pdf" />
                <p>Drag 'n' drop a file here, or click to select one</p>
            </div>
            <button onClick={handleFileUpload} disabled={!file || isLoading}>
                {isLoading ? "Processing..." : "Process Image"}
            </button>
            {ocrResult && (
                <div style={{ marginTop: '20px' }}>
                    <h2>OCR Result:</h2>
                    <pre style={{ background: '#f0f0f0', padding: '10px', borderRadius: '5px' }}>
                        {ocrResult}
                    </pre>
                </div>
            )}
        </div>
    );
};

export default OCR;
