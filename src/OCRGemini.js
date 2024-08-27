import React, { useCallback, useState } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { Trash2, Upload, Lock, MapPinHouse } from 'lucide-react';
import './OCR.css';
import { PDFLoader } from 'react-pdf-js';

const OCRGemini = () => {
    const [files, setFiles] = useState([]);
    const [ocrResults, setOCRResults] = useState([]);
    const [keywordResults, setKeywordResults] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [address, setAddress] = useState('');
    const [password, setPassword] = useState('');

    const displayKeywords = ["Company", "Netto", "Steuer", "Brutto", "MwSt", "Summe",
        "Rechnungsdatum", "Rechnungsnummer"];
    const tableKeywords = ["Company", "Netto", "Steuer", "Brutto", "MwSt",
        "Rechnungsdatum", "Rechnungsnummer"];

    const onDrop = useCallback((acceptedFiles) => {
        setFiles(prevFiles => [...prevFiles, ...acceptedFiles]);
    }, []);

    const removeFile = (index) => {
        const newFiles = files.filter((_, i) => i !== index);
        setFiles(newFiles);
    };

    const handleCellValueChange = (keyword, value, fileIndex) => {
        setKeywordResults(prevResults => ({
            ...prevResults,
            [keyword]: prevResults[keyword].map((result, index) =>
                index === fileIndex ? { ...result, value } : result
            )
        }));
    };

    const handleFlushFiles = () => {
        setFiles([]);
        setOCRResults([]);
        setKeywordResults({});
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    const handleFileUpload = async () => {
        if (files.length === 0) return;

        setIsLoading(true);

        const newOCRResults = [];
        const newKeywordResults = {};

        for (const file of files) {
            try {
                const base64data = await convertToBase64(file);
                const result = await processInvoiceWithGemini(base64data);
                newOCRResults.push(result);

                const keyMapping = {
                    "company_name": "Company",
                    "netto_amount": "Netto",
                    "steuer_amount": "Steuer",
                    "brutto_amount": "Brutto",
                    "mwst_percentage": "MwSt",
                    "summe_amount": "Summe",
                    "invoice_date": "Rechnungsdatum",
                    "invoice_number": "Rechnungsnummer"
                };

                displayKeywords.forEach(keyword => {
                    if (!newKeywordResults[keyword]) {
                        newKeywordResults[keyword] = [];
                    }
                    const jsonKey = Object.keys(keyMapping).find(key => keyMapping[key] === keyword);
                    newKeywordResults[keyword].push({ value: result[jsonKey] || '' });                });

                // Verify calculations
                // verifyCalculations(result, newKeywordResults);

            } catch (error) {
                console.error("Error during invoice processing:", error);
                newOCRResults.push({ error: error.message });
                displayKeywords.forEach(keyword => {
                    if (!newKeywordResults[keyword]) {
                        newKeywordResults[keyword] = [];
                    }
                    newKeywordResults[keyword].push({ value: 'Error', error: true });
                });
            }
        }

        setOCRResults(newOCRResults);
        setKeywordResults(newKeywordResults);
        setIsLoading(false);
    };

    const convertToBase64 = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = (error) => {
                console.error("Error reading file:", error);
                setIsLoading(false);
            };
        });
    };

    const processInvoiceWithGemini = async (base64Image) => {
        const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("Gemini API key is not set");
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        const prompt = `Analyze this invoice image and extract the following information:
            - Company name
            - Invoice number
            - Invoice date
            - Netto amount
            - Steuer (tax) amount
            - Brutto (gross) amount
            - MwSt (VAT) percentage
            - Summe (total) amount
            Return the results as a JSON object with lowercase keys.`;

        try {
            const response = await axios.post(url, {
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType: "image/jpeg", data: base64Image } }
                        ]
                    }
                ]
            });

            console.log("Raw Gemini API Response:", JSON.stringify(response.data, null, 2));

            if (response.data && response.data.candidates && response.data.candidates[0].content) {
                const text = response.data.candidates[0].content.parts[0].text;
                console.log("Extracted text from Gemini response:", text);
                const extractedJson = extractJsonFromText(text);
                console.log("Extracted JSON:", extractedJson);
                return extractedJson;
            } else {
                console.error("Unexpected response structure:", response.data);
                throw new Error("Unexpected response format from Gemini API");
            }
        } catch (error) {
            console.error("Gemini API error:", error.response ? error.response.data : error.message);
            throw error;
        }
    };

    const extractJsonFromText = (text) => {
        console.log("Attempting to extract JSON from:", text);
        try {
            // Try to parse the entire text as JSON first
            return JSON.parse(text);
        } catch (e) {
            console.log("Failed to parse entire text as JSON, attempting to extract from markdown");
            // If that fails, try to extract JSON from markdown code blocks
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch && jsonMatch[1]) {
                console.log("Found potential JSON in markdown:", jsonMatch[1]);
                try {
                    return JSON.parse(jsonMatch[1].trim());
                } catch (innerError) {
                    console.error("Error parsing extracted JSON:", innerError);
                }
            }

            // If both attempts fail, throw an error
            console.error("Failed to extract valid JSON from the response");
            throw new Error("Failed to extract valid JSON from the response");
        }
    };

    const verifyCalculations = (result, newKeywordResults) => {
        const netto = parseFloat(result.netto_amount.replace(',', '.'));
        const brutto = parseFloat(result.brutto_amount.replace(',', '.'));
        const summe = parseFloat(result.summe_amount.replace(',', '.'));
        const mwst = parseFloat(result.mwst_percentage.replace(',', '.'));

        // Verify Netto calculation
        const calculatedNetto = brutto / (1 + mwst / 100);
        if (Math.abs(calculatedNetto - netto) > 0.01) {
            console.warn("Netto amount may be incorrect. Calculated:", calculatedNetto, "Extracted:", netto);
            newKeywordResults["Netto"][newKeywordResults["Netto"].length - 1].warning = true;
        }

        // Verify Summe
        if (Math.abs(brutto - summe) > 0.01) {
            console.warn("Summe may be incorrect. Brutto:", brutto, "Summe:", summe);
            newKeywordResults["Summe"][newKeywordResults["Summe"].length - 1].warning = true;
        }

        // Verify Steuer
        const calculatedSteuer = brutto - netto;
        const extractedSteuer = parseFloat(result.steuer_amount.replace(',', '.'));
        if (Math.abs(calculatedSteuer - extractedSteuer) > 0.01) {
            console.warn("Steuer amount may be incorrect. Calculated:", calculatedSteuer, "Extracted:", extractedSteuer);
            newKeywordResults["Steuer"][newKeywordResults["Steuer"].length - 1].warning = true;
        }
    };

    const handleMakeBillWithLexOffice = () => {
        console.log("Make Bill with LexOffice:", address, password, keywordResults);
    };

    return (
        <div className="ocr-container">
            <div className="ocr-content">
                <div className="ocr-upload-section">
                    <div {...getRootProps()} className="dropzone">
                        <input {...getInputProps()} />
                        {isDragActive ? (
                            <p>Drop the files here ...</p>
                        ) : (
                            <p>Drag 'n' drop some files here, or click to select files</p>
                        )}
                        <Upload className="upload-icon" />
                    </div>
                    <ul className="file-list">
                        {files.map((file, index) => (
                            <li key={index} className="file-item">
                                <span>{file.name}</span>
                                <button onClick={() => removeFile(index)} className="delete-button">
                                    <Trash2 size={18} />
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="button-group">
                        <button onClick={handleFileUpload} className="process-button">
                            {isLoading ? 'Processing...' : 'Process Files'}
                        </button>
                        <button onClick={handleFlushFiles} className="flush-button">
                            Flush Files
                        </button>
                    </div>
                </div>
                <div className="ocr-results-section">
                    <table className="ocr-table">
                        <thead>
                        <tr>
                            {tableKeywords.map(keyword => (
                                <th key={keyword}>{keyword}</th>
                            ))}
                        </tr>
                        </thead>
                        <tbody>
                        {ocrResults && ocrResults.map((_, fileIndex) => (
                            <tr key={fileIndex}>
                                {tableKeywords.map(keyword => (
                                    <td key={`${keyword}-${fileIndex}`}>
                                        <input
                                            type="text"
                                            value={keywordResults[keyword]?.[fileIndex]?.value || ''}
                                            onChange={(e) => handleCellValueChange(keyword, e.target.value, fileIndex)}
                                            className={`ocr-input ${keywordResults[keyword]?.[fileIndex]?.warning ? 'warning' : ''}`}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                        </tbody>
                    </table>
                    <div className="lexoffice-section">
                        <div className="input-group">
                            <MapPinHouse className="input-icon"/>
                            <input
                                type="text"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Address"
                                className="lexoffice-input"
                            />
                        </div>
                        <div className="input-group">
                            <Lock className="input-icon"/>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                className="lexoffice-input"
                            />
                        </div>
                        <button onClick={handleMakeBillWithLexOffice} className="lexoffice-button">
                            Create LexOffice Bill
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OCRGemini;