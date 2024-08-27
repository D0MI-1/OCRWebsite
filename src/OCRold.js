import React, { useState } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';

const OCRold = () => {
    const [file, setFile] = useState(null);
    const [ocrResult, setOCRResult] = useState(null);
    const [keywordResults, setKeywordResults] = useState(null);
    const [allWordsWithPositions, setAllWordsWithPositions] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    const keywords = ["Netto", "Steuer", "Brutto", "Steuer %", "Summe", "Rechnungsdatum", "Rechnungsnummer", "MwSt"];

    const onDrop = (acceptedFiles) => {
        console.log("Files dropped:", acceptedFiles);
        setFile(acceptedFiles[0]);
    };

    const { getRootProps, getInputProps } = useDropzone({ onDrop });

    const handleFileUpload = async () => {
        if (!file) return;

        console.log("File selected for upload:", file);
        setIsLoading(true);

        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onloadend = async () => {
            const base64data = reader.result.split(',')[1];
            console.log("Base64 data generated");

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
                                features: [
                                    { type: 'TEXT_DETECTION' },
                                    { type: 'DOCUMENT_TEXT_DETECTION' }
                                ]
                            }
                        ]
                    },
                    { headers: { 'Content-Type': 'application/json' } }
                );

                console.log("API Response received");
                const fullTextAnnotation = response.data.responses[0]?.fullTextAnnotation;
                setOCRResult(fullTextAnnotation?.text || "No text found.");

                if (fullTextAnnotation) {
                    const companyName = detectCompany(fullTextAnnotation.text);
                    console.log("Detected company:", companyName);
                    const { results, allWords } = processKeywords(fullTextAnnotation, keywords, companyName);
                    setKeywordResults(results);
                    setAllWordsWithPositions(allWords);
                } else {
                    console.error("No full text annotation found in API response");
                }
            } catch (error) {
                console.error("Error during OCR API request:", error);
            } finally {
                setIsLoading(false);
            }
        };

        reader.onerror = (error) => {
            console.error("Error reading file:", error);
            setIsLoading(false);
        };
    };

    const detectCompany = (text) => {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('hagebaumarkt')) return 'hagebaumarkt';
        if (lowerText.includes('bauhaus')) return 'bauhaus';
        return 'unknown';
    };

    const processKeywords = (fullTextAnnotation, keywords, companyName) => {
        console.log("Processing keywords for company:", companyName);
        const results = {};
        const pages = fullTextAnnotation.pages || [];

        keywords.forEach(keyword => {
            results[keyword] = { found: false, value: null, position: null };
        });

        const allWords = pages.flatMap(page =>
            page.blocks.flatMap(block =>
                block.paragraphs.flatMap(paragraph =>
                    paragraph.words.map(word => ({
                        text: word.symbols.map(symbol => symbol.text).join(''),
                        position: getWordPosition(word)
                    }))
                )
            )
        );

        console.log("Total words found:", allWords.length);

        allWords.forEach((word, index) => {
            keywords.forEach(keyword => {
                if (word.text.toLowerCase().includes(keyword.toLowerCase())) {
                    console.log(`Found keyword: ${keyword} at index ${index}`);
                    results[keyword].found = true;
                    results[keyword].position = word.position;
                    if (companyName === 'hagebaumarkt') {
                        results[keyword].value = findAssociatedValueHagebau(allWords, index, word.position, keyword);
                    } else if (companyName === 'bauhaus') {
                        results[keyword].value = findAssociatedValueBauhaus(allWords, index, word.position, keyword);
                    }
                    console.log(`Value for ${keyword}:`, results[keyword].value);
                }
            });
        });

        // Special case for "Steuer %"
        if (!results["Steuer %"].found) {
            const steuerIndex = allWords.findIndex(word => word.text.toLowerCase() === "steuer");
            if (steuerIndex !== -1 && allWords[steuerIndex + 1]?.text === "%") {
                console.log("Found special case for Steuer %");
                results["Steuer %"].found = true;
                results["Steuer %"].position = allWords[steuerIndex].position;
                if (companyName === 'hagebaumarkt') {
                    results["Steuer %"].value = findAssociatedValueHagebau(allWords, steuerIndex, allWords[steuerIndex].position, "Steuer %");
                } else if (companyName === 'bauhaus') {
                    results["Steuer %"].value = findAssociatedValueBauhaus(allWords, steuerIndex, allWords[steuerIndex].position, "Steuer %");
                }
                console.log("Steuer % value:", results["Steuer %"].value);
            }
        }

        return { results, allWords };
    };

    const getWordPosition = (word) => {
        const vertices = word.boundingBox.vertices;
        return {
            x: (vertices[0].x + vertices[1].x) / 2,
            y: (vertices[0].y + vertices[3].y) / 2
        };
    };

    const findAssociatedValueHagebau = (allWords, keywordIndex, keywordPosition, keyword) => {
        const searchRadius = keyword === 'Summe' ? 500 : 100;
        let closestValue = null;
        let minDistance = Infinity;

        // Search both backwards and forwards
        for (let i = 0; i < allWords.length; i++) {
            const word = allWords[i];
            const distance = Math.sqrt(
                Math.pow(word.position.x - keywordPosition.x, 2) +
                Math.pow(word.position.y - keywordPosition.y, 2)
            );

            if (distance <= searchRadius) {
                // Improved number recognition regex
                const numberMatch = word.text.match(/^[-+]?[0-9]*[.,]?[0-9]+(?:[eE][-+]?[0-9]+)?$/);
                if (numberMatch) {
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestValue = numberMatch[0].replace(',', '.');
                    }
                }
            }
        }

        console.log(`Hagebau - Closest value for ${keyword}:`, closestValue, "Distance:", minDistance);
        return closestValue ? parseFloat(closestValue) : null;
    };

    const findAssociatedValueBauhaus = (allWords, keywordIndex, keywordPosition, keyword) => {
        const searchRadius = 200;
        let closestValue = null;
        let minDistance = Infinity;

        for (let i = keywordIndex + 1; i < allWords.length; i++) {
            const word = allWords[i];
            const distance = Math.sqrt(
                Math.pow(word.position.x - keywordPosition.x, 2) +
                Math.pow(word.position.y - keywordPosition.y, 2)
            );

            if (distance <= searchRadius) {
                if (keyword === 'Rechnungsdatum' || keyword === 'Rechnungsnummer') {
                    closestValue = word.text;
                    break;
                } else if (/^(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{1,2})?)$/.test(word.text)) {
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestValue = word.text.replace('.', '').replace(',', '.');
                    }
                }
            } else {
                break;
            }
        }

        console.log(`Bauhaus - Closest value for ${keyword}:`, closestValue);
        return keyword === 'Rechnungsdatum' || keyword === 'Rechnungsnummer'
            ? closestValue
            : closestValue ? parseFloat(closestValue) : null;
    };


    return (
        <div style={{ padding: '20px' }}>
            <h1>Enhanced Google Vision OCR</h1>
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
            {keywordResults && (
                <div style={{ marginTop: '20px' }}>
                    <h2>Keyword Results:</h2>
                    <ul>
                        {Object.entries(keywordResults).map(([keyword, result]) => (
                            <li key={keyword}>
                                <strong>{keyword}:</strong> {result.found ? `${result.value} (Position: x=${result.position.x.toFixed(2)}, y=${result.position.y.toFixed(2)})` : 'Not found'}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {allWordsWithPositions && (
                <div style={{ marginTop: '20px' }}>
                    <h2>All Recognized Words with Positions:</h2>
                    <ul style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ccc', padding: '10px' }}>
                        {allWordsWithPositions.map((word, index) => (
                            <li key={index}>
                                <strong>{word.text}</strong> (Position: x={word.position.x.toFixed(2)}, y={word.position.y.toFixed(2)})
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default OCRold;