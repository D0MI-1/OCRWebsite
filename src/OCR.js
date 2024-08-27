import React, {useCallback, useState} from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import { Trash2, Upload, Lock, AtSign } from 'lucide-react';
import './OCR.css';

const OCR = () => {
    const [files, setFiles] = useState([]);
    const [ocrResults, setOCRResults] = useState(null);
    const [keywordResults, setKeywordResults] = useState({});
    const [, setAllWordsWithPositions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [address, setAddress] = useState('');
    const [password, setPassword] = useState('');

    const companies = ['hagebaumarkt', 'bauhaus', 'ginger', 'inexio', 'hornbach'];
    const keywords = ["Netto", "Steuer", "Brutto", "Steuer %", "Summe",
                              "Rechnungsdatum", "Rechnungsnummer", "MwSt"];

    const displayKeywords = ["Company", "Netto", "Steuer", "Brutto", "MwSt", "Summe",
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
        setKeywordResults([]);
        setAllWordsWithPositions([]);
    };


    const {getRootProps, getInputProps, isDragActive } = useDropzone({onDrop});

    const handleFileUpload = async () => {
        if (files.length === 0) return;

        setIsLoading(true);
        //const results = [];

        const newOCRResults = [];
        const newKeywordResults = {};
        const newAllWordsWithPositions = [];

        for (const file of files) {
            try {
                const base64data = await convertToBase64(file);
                const apiKey = process.env.REACT_APP_API_KEY || 'your-api-key-here';

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

                console.log("API RESPONSE received")
                const fullTextAnnotation = response.data.responses[0]?.fullTextAnnotation;
                newOCRResults.push(fullTextAnnotation);

                if (fullTextAnnotation){
                    // TODO compare detectCompany
                    const companyName = detectCompanyWithLevenshtein(fullTextAnnotation.text);
                    console.log("Detected company:", companyName);
                    const { results, allWords } = processKeywords(fullTextAnnotation, keywords, companyName)
                    Object.entries(results).forEach(([keyword, result]) => {
                        if (!newKeywordResults[keyword]) {
                            newKeywordResults[keyword] = [];
                        }
                        newKeywordResults[keyword].push(result);
                    });

                    if (!newKeywordResults["Company"]) {
                        newKeywordResults["Company"] = [];
                    }
                    newKeywordResults["Company"].push({value: companyName});

                    newAllWordsWithPositions.push(...allWords);
                } else {
                    console.error("No full text annotation found in API response");
                }
            } catch (error) {
                console.error("Error during OCR API request:", error);
            }
        }
        setOCRResults(newOCRResults);
        setKeywordResults(newKeywordResults);
        setAllWordsWithPositions(newAllWordsWithPositions);
        setIsLoading(false);
    }
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

    const detectCompany = (text) => {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('hagebaumarkt')) return 'hagebaumarkt';
        if (lowerText.includes('bauhaus')) return 'bauhaus';
        if (lowerText.includes('ginger')) return 'ginger';
        if (lowerText.includes('inexio')) return 'inexio';
        if (lowerText.includes('hornbach')) return 'hornbach';
        return 'unknown';
    };

    const detectCompanyWithLevenshtein = (text) => {
        const lowerText = text.toLowerCase();
        const threshold = 3; // Maximum allowed Levenshtein distance

        for (const company of companies) {
            const words = lowerText.split(/\s+/);
            for (const word of words) {
                if (levenshteinDistance(word, company) <= threshold) {
                    return company;
                }
            }
        }

        return 'unknown';
    };

    function levenshteinDistance(a, b){
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        Math.min(
                            matrix[i][j - 1] + 1, // insertion
                            matrix[i - 1][j] + 1  // deletion
                        )
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    const processKeywords = (fullTextAnnotation, keywords, companyName) => {
        console.log("Processing keywords for company:", companyName);
        const results = {};
        const pages = fullTextAnnotation.pages || [];

        keywords.forEach(keyword => {
            results[keyword] = { found: false, value: null, position: null};
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


                    if (companies.includes(companyName)) {
                        switch (companyName) {
                            case 'hagebaumarkt':
                                results[keyword].value = findAssociatedValueHagebau(allWords, index, word.position, keyword);
                                break;
                            case 'bauhaus':
                                results[keyword].value = findAssociatedValueBauhaus(allWords, index, word.position, keyword);
                                break;
                            case 'ginger':
                                results[keyword].value = findAssociatedValueGinger(allWords, index, word.position, keyword);
                                break;
                            case 'inexio':
                                results[keyword].value = findAssociatedValueInexio(allWords, index, word.position, keyword);
                                break;
                            case 'hornbach':
                                results[keyword].value = findAssociatedValueHornbach(allWords, index, word.position, keyword);
                                break;
                            default:
                                console.error('Unsupported company:', companyName);
                        }
                    } else {
                        console.warn('Company not supported:', companyName);
                    }
                    console.log(`Value for ${keyword}:`, results[keyword].value);
                }
            })
        });

        // Special case for "Steuer %"
        if(companyName === "hagebaumarkt"){
            const steuerIndices = allWords.reduce((acc, word, index) => {
                if (word.text.toLowerCase() === "steuer"){
                    acc.push(index);
                }
                return acc;
            }, []);

            steuerIndices.forEach(steuerPosition => {
                if (!results["Steuer %"].found) {
                    const radius = 5; // Adjust the radius as needed
                    const nearbyWords = allWords.filter((word, index) => {
                        const wordPosition = word.position; // Use getWordPosition
                        const distance = Math.hypot(steuerPosition.x - wordPosition.x, steuerPosition.y - wordPosition.y);
                        return distance <= radius;
                    });

                    const hasPercent = nearbyWords.some(word => word.text.toLowerCase() === "%") || nearbyWords.some(word => word.text.toLowerCase().includes("%"));

                    if (hasPercent) {
                        results["MwSt"].found = true;

                        // Calculate average position using getWordPosition
                        const percentIndex = nearbyWords.findIndex(word => word.text.toLowerCase() === "%");
                        const steuerAvgPosition = steuerPosition;
                        const percentAvgPosition = nearbyWords[percentIndex].position;
                        results["MwSt"].position = {
                            x: (steuerAvgPosition.x + percentAvgPosition.x) / 2,
                            y: (steuerAvgPosition.y + percentAvgPosition.y) / 2
                        };
                        results["MwSt"].value = findAssociatedValueHagebau(allWords, steuerPosition, results["MwSt"].position, "MwSt");

                        console.log("Steuer % value:", results["Steuer %"].value);
                    }
                }
            });
        }

        return { results, allWords};
    };

    const getWordPosition = (word) => {

        //https://cloud.google.com/vision/docs/reference/rest/v1p2beta1/images/annotate#word
        // idk why my ide is showing Unresolved variable boundingBox
        const vertices = word.boundingBox.vertices;
        return {
            // 0----1
            // |    |
            // 3----2
            x: (vertices[0].x + vertices[1].x) / 2,
            y: (vertices[0].y + vertices[3].y) / 2
        };
    };

    const findAssociatedValueHagebau = (allWords, keywordIndex, keywordPosition, keyword) => {
        const searchRadius = keyword === 'Summe' ? 200 : 50; // Adjust radii as needed
        let closestValue = null;
        let minDistance = Infinity;

        // Search both backwards and forwards
        for (let i = 0; i < allWords.length; i++) {
            const word = allWords[i];
            const distance = Math.hypot(
                word.position.x - keywordPosition.x,
                word.position.y - keywordPosition.y
            );

            if (distance <= searchRadius) {
                // Improved number recognition regex
                const numberMatch = word.text.match(/^[-+]?[0-9]*[.,]?[0-9]+(?:[eE][-+]?[0-9]+)?$/);
                if (numberMatch) {
                    if (keyword === 'Summe' && Math.abs(word.position.y - keywordPosition.y) > 20) {
                        continue; // Skip words too far away on the y-axis for "Summe"
                    }

                    // Check x-axis difference for "Netto", "Steuer", "Brutto", and "Steuer %"
                    if (['Netto', 'Steuer', 'Brutto', 'Steuer %'].includes(keyword) && Math.abs(word.position.x - keywordPosition.x) > 20) {
                        continue; // Skip words too far away on the x-axis
                    }

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

    }

    const findAssociatedValueGinger = (allWords, keywordIndex, keywordPosition, keyword) => {

    }

    const findAssociatedValueHornbach = (allWords, keywordIndex, keywordPosition, keyword) => {

    }

    const findAssociatedValueInexio = (allWords, keywordIndex, keywordPosition, keyword) => {

    }

    const handleMakeBillWithLexOffice = () => {

        console.log("Make Bill with Lex Office:", address, password, keywordResults);
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
                        {displayKeywords.map(keyword => (
                            <th key={keyword}>{keyword}</th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {ocrResults && ocrResults.map((_, fileIndex) => (
                        <tr key={fileIndex}>
                            {displayKeywords.map(keyword => (
                                <td key={`${keyword}-${fileIndex}`}>
                                    <input
                                        type="text"
                                        value={keywordResults[keyword]?.[fileIndex]?.value || ''}
                                        onChange={(e) => handleCellValueChange(keyword, e.target.value, fileIndex)}
                                        className="ocr-input"
                                    />
                                </td>
                            ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
                    <div className="lexoffice-section">
                        <div className="input-group">
                            <AtSign className="input-icon" />
                            <input
                                type="text"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Address"
                                className="lexoffice-input"
                            />
                        </div>
                        <div className="input-group">
                            <Lock className="input-icon" />
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

export default OCR;