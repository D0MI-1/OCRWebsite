import React, {useCallback, useState} from 'react';
import axios from 'axios';
import {useDropzone} from 'react-dropzone';
import {Lock, MapPinHouse, Trash2, Upload} from 'lucide-react';
import * as PDFJS from 'pdfjs-dist/webpack';

import './OCR.css';

const OCRGemini = () => {
    const [files, setFiles] = useState([]);
    const [ocrResults, setOCRResults] = useState([]);
    const [keywordResults, setKeywordResults] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [address, setAddress] = useState('');
    const [password, setPassword] = useState('');
    /* eslint-disable no-unused-vars */

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
                index === fileIndex ? {...result, value} : result
            )
        }));
    };

    const handleFlushFiles = () => {
        setFiles([]);
        setOCRResults([]);
        setKeywordResults({});
    };

    const {getRootProps, getInputProps, isDragActive} = useDropzone({onDrop});

    const accumulateResults = (fileResults) => {
        const accumulated = {};
        fileResults.forEach((result, index) => {
            Object.entries(result).forEach(([key, value]) => {
                if (["netto_amount", "steuer_amount", "brutto_amount", "mwst_percentage"].includes(key)) {
                    accumulated[key] = value; // Always update these values
                } else if (!accumulated[key] || index === 0) {
                    accumulated[key] = value; // Set other values only if not set or it's the first page
                }
            });
        });
        return accumulated;
    };

    const handleFileUpload = async () => {
        if (files.length === 0) return;

        setIsLoading(true);

        const newOCRResults = [];
        const newKeywordResults = {};

        for (const file of files) {
            try {
                let pages;
                if (file.type === 'application/pdf') {
                    pages = await convertPdfToImages(file);
                } else {
                    const base64data = await convertToBase64(file);
                    pages = [base64data];
                }

                const pageResults = [];
                for (const page of pages) {
                    const result = await processInvoiceWithGemini(page);
                    pageResults.push(result);
                }

                const accumulatedResult = accumulateResults(pageResults);
                newOCRResults.push(accumulatedResult);

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
                    newKeywordResults[keyword].push({value: accumulatedResult[jsonKey] || ''});
                });

            } catch (error) {
                console.error("Error during file processing:", error);
                newOCRResults.push({error: error.message});
                displayKeywords.forEach(keyword => {
                    if (!newKeywordResults[keyword]) {
                        newKeywordResults[keyword] = [];
                    }
                    newKeywordResults[keyword].push({value: 'Error', error: true});
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

    const convertPdfToImages = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const arrayBuffer = event.target.result;
                try {
                    const pdf = await PDFJS.getDocument(arrayBuffer).promise;
                    const pages = [];
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await getPage(pdf, i);
                        pages.push(page);
                    }
                    resolve(pages);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = (error) => reject(error);
            reader.readAsArrayBuffer(file);
        });
    };

    const getPage = (pdf, num) => {
        return new Promise((resolve, reject) => {
            pdf.getPage(num).then(page => {
                const scale = 1.5;
                const viewport = page.getViewport({scale: scale});
                const canvas = document.createElement('canvas');
                const canvasContext = canvas.getContext('2d');
                canvas.height = viewport.height || viewport.viewBox[3];
                canvas.width = viewport.width || viewport.viewBox[2];
                page.render({
                    canvasContext, viewport
                }).promise.then(() => {
                    resolve(canvas.toDataURL().split(',')[1]);
                }).catch(reject);
            }).catch(reject);
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
                            {text: prompt},
                            {inlineData: {mimeType: "image/jpeg", data: base64Image}}
                        ]
                    }
                ]
            });

            //console.log("Raw Gemini API Response:", JSON.stringify(response.data, null, 2));

            if (response.data && response.data.candidates && response.data.candidates[0].content) {
                const text = response.data.candidates[0].content.parts[0].text;
                //console.log("Extracted text from Gemini response:", text);
                const extractedJson = extractJsonFromText(text);
                //console.log("Extracted JSON:", extractedJson);
                return extractedJson;
            } else {
                console.error("Unexpected response structure:", response.data);
                //throw new Error("Unexpected response format from Gemini API");
            }
        } catch (error) {
            console.error("Gemini API error:", error.response ? error.response.data : error.message);
            throw error;
        }
    };

    const extractJsonFromText = (text) => {
        //console.log("Attempting to extract JSON from:", text);
        try {
            // Try to parse the entire text as JSON first
            return JSON.parse(text);
        } catch (e) {
            //console.log("Failed to parse entire text as JSON, attempting to extract from markdown");
            // If that fails, try to extract JSON from markdown code blocks
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch && jsonMatch[1]) {
                //console.log("Found potential JSON in markdown:", jsonMatch[1]);
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
    // eslint-disable-next-line no-unused-vars
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

    const getCurrentFormattedDate = () => {
        const date = new Date();

        // Get the date part in YYYY-MM-DD format
        const formattedDate = date.toISOString().split('T')[0];

        // Get hours and minutes
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        // Construct the time part
        const timePart = `T${hours}:${minutes}:07.480+02:00`;

        // Combine date and time
        return formattedDate + timePart;
    };

    const handleMakeBillWithLexOffice = async (sendImmediately = false) => {
        //console.log(`handleMakeBillWithLexOffice called with sendImmediately: ${sendImmediately}`);

        if (password !== process.env.REACT_APP_PASSWORT) {
            console.error('Unauthorized user attempted to create a Lexoffice bill');
            alert('You are not authorized to create Lexoffice bills.');
            return;
        }

        const WORKER_URL = process.env.REACT_APP_WORKER_URL;

        let remarkText = "Bei Fragen stehen wir Ihnen gerne zur Verfügung.";
        const date = new Date();
        const formattedDate = date.toISOString().split('T')[0];
        // eslint-disable-next-line no-unused-vars
        const timePart = "T00:00:07.480+02:00";
        const finalDate = getCurrentFormattedDate();

        const lineItems = [];
        let totalNetAmount = 0;
        let totalGrossAmount = 0;
        const attachments = [];

        // Iterate through all items in the table
        for (let i = 0; i < keywordResults["Company"].length; i++) {
            const companyName = keywordResults["Company"][i]?.value || "";
            const nettoAmount = parseFloat(keywordResults["Netto"][i]?.value.replace(',', '.') || "0");
            const bruttoAmount = parseFloat(keywordResults["Brutto"][i]?.value.replace(',', '.') || "0");
            const mwst = parseFloat(keywordResults["MwSt"][i]?.value.replace(',', '.') || "0");
            const invoiceDate = keywordResults["Rechnungsdatum"][i]?.value || formattedDate;
            const invoiceNumber = keywordResults["Rechnungsnummer"][i]?.value || "";

            // Calculate tax rate
            let taxRate;
            if (mwst > 0) {
                taxRate = mwst;
            } else if (nettoAmount > 0 && bruttoAmount > 0) {
                taxRate = ((bruttoAmount / nettoAmount) - 1) * 100;
            } else {
                taxRate = 19; // Default to 19% if calculation is not possible
            }

            // Format item description based on company name
            let itemName, itemDescription;
            if (companyName.toLowerCase().includes("hagebaumarkt") || companyName.toLowerCase().includes("bauhaus")) {
                itemName = `Rechnung für Baustoffe ${companyName} vom ${invoiceDate}`;
                itemDescription = `Baustoffe`;
            } else if (companyName.toLowerCase().includes("ginger") || companyName.toLowerCase().includes("gienger")) {
                itemName = "Baustoffe von Gienger Haustechnik";
                itemDescription = `Rechnung für Rechnungsnummer ${invoiceNumber} für Baustoffe von Gienger München KG Haustechnik vom ${invoiceDate}`;
            } else {
                itemName = `Rechnung ${companyName}`;
                itemDescription = `Baustoffe vom ${invoiceDate}`;
            }

            lineItems.push({
                type: "custom",
                name: itemName,
                description: itemDescription,
                quantity: 1,
                unitName: "Stück",
                unitPrice: {
                    currency: "EUR",
                    netAmount: nettoAmount,
                    grossAmount: bruttoAmount,
                    taxRatePercentage: taxRate
                }
            });

            totalNetAmount += nettoAmount;
            totalGrossAmount += bruttoAmount;

            if (files[i]) {
                const fileContent = await readFileAsBase64(files[i]);
                attachments.push({
                    filename: files[i].name,
                    content: fileContent,
                    mimeType: files[i].type
                });
            }
        }

        try {
            const invoiceData = {
                voucherDate: finalDate,
                address: {
                    street: process.env.REACT_APP_STREET,
                    zip: process.env.REACT_APP_ZIP,
                    city: process.env.REACT_APP_CITY,
                    name: process.env.REACT_APP_NAME,
                    countryCode: process.env.REACT_APP_COUNTRY_CODE,
                    contactId: process.env.REACT_APP_CONTACTID
                },
                lineItems: lineItems,
                totalPrice: {
                    currency: "EUR",
                    totalNetAmount: totalNetAmount,
                    totalGrossAmount: totalGrossAmount,
                    totalTaxAmount: parseFloat((totalGrossAmount - totalNetAmount).toFixed(4))
                },
                taxConditions: {
                    taxType: "net"
                },
                paymentConditions: {
                    paymentTermLabel: "Zahlbar innerhalb von 7 Tagen",
                    paymentTermDuration: 7
                },
                shippingConditions: {
                    shippingType: "none"
                },
                title: `Rechnung`,
                introduction: `Sehr geehrte Damen und Herren\n\nwir erlauben uns, wie folgt Rechnung zu stellen: \n\nObjekt: ${address}`,
                remark: remarkText,
                customFields: [],
                voucherStatus: "open", // Set the invoice status to open

                attachments: attachments
            };

            //console.log('Sending invoice data:', JSON.stringify(invoiceData));

            // Create the invoice using your Cloudflare Worker
            const response = await axios.post(WORKER_URL, invoiceData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            //console.log('Invoice created successfully:', response.data);

            if (!sendImmediately) {
                alert('Invoice created successfully!');
                return;
            }

            if (sendImmediately && response.data.id) {
                const formattedDate = new Date().toLocaleDateString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });

                //console.log('Sending email request...');
                try {
                    const emailResponse = await axios.post(`${WORKER_URL}/send-email`, {
                        invoiceId: response.data.id,
                        recipientEmail: process.env.REACT_APP_SEND_MAIL_TO,
                        senderEmail: process.env.REACT_APP_SEND_MAIL_FROM,
                        subject: `Rechnung ${response.data.voucherNumber} Baustoffe ${address}`,
                        text: `Sehr geehrte Damen und Herren,\n\nim Anhang finden Sie Ihre Rechnung ${response.data.voucherNumber} vom ${formattedDate}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen`
                    });

                    if (emailResponse.status === 200) {
                        //console.log('Invoice finalized and sent successfully');
                        alert('Invoice created and email sent successfully!');
                    } else {
                        console.error('Failed to send email:', emailResponse.data);
                        alert('Invoice created, but failed to send email. Please check the logs for more information.');
                    }
                } catch (emailError) {
                    console.error('Error sending email:', emailError);
                    alert(`Invoice created, but an error occurred while sending the email: ${emailError.message}`);
                }
            } else {
                alert('Invoice created successfully!');
            }
        } catch (error) {
            console.error('Error creating or sending invoice:', error);
            if (error.response) {
                console.error('Error response:', error.response.data);
            }
            alert(`An error occurred: ${error.message}`);
        }

        //console.log("Make Bill with LexOffice:", address, password, keywordResults);
    };

    const readFileAsBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    };

    //* Insert button back when we find a possibilty to send emails
    // <!--<button
    //                             onClick={() => {
    //                                 if (window.confirm(`Are you sure you want to create and send an invoice with ${keywordResults["Company"].length} items?`)) {
    //                                     handleMakeBillWithLexOffice(true);
    //                                 }
    //                             }}
    //                             className="send-invoice-button"
    //                         >
    //                             Create and Send Invoice
    //                         </button>-->
//
//    <button onClick={handleFetchInvoices} className="fetch-invoices-button">
//        Fetch Invoices
//    </button>
//     *//

    const fetchInvoices = async () => {
        try {
            const response = await axios.get(`${process.env.REACT_APP_WORKER_URL}/invoices`, {
                headers: {
                    'Accept': 'application/json'
                },
                params: {page: 0, size: 100}
            });

            //console.log('Fetched invoices:', response.data);
            return response.data;
        } catch (error) {
            console.error('Error fetching invoices:', error);
            if (error.response) {
                console.error('Error response:', error.response.data);
            }
            throw error;
        }
    };
    // eslint-disable-next-line no-unused-vars
    const handleFetchInvoices = async () => {
        try {
            const invoices = await fetchInvoices();
            //console.log('Invoices:', invoices);
            alert('Invoices fetched successfully. Check the console for details.');
        } catch (error) {
            console.error('Failed to fetch invoices:', error);
            alert('Failed to fetch invoices. Check the console for details.');
        }
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
                        <Upload className="upload-icon"/>
                    </div>
                    <ul className="file-list">
                        {files.map((file, index) => (
                            <li key={index} className="file-item">
                                <span>{file.name}</span>
                                <button onClick={() => removeFile(index)} className="delete-button">
                                    <Trash2 size={18}/>
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
                        <button
                            onClick={() => handleMakeBillWithLexOffice(false)}
                            className="lexoffice-button"
                        >
                            Create LexOffice Bill
                        </button>
                        <button onClick={() => {
                            if (window.confirm(`Are you sure you want to create and send an invoice with ${keywordResults["Company"].length} items?`)) {
                                handleMakeBillWithLexOffice(true);
                            }
                        }
                        }
                                className="send-invoice-button"
                        >
                            Create and Send Invoice
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OCRGemini;