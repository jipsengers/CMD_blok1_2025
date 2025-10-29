(async () => {
    if (typeof tmImage === "undefined") {
        console.error("tmImage is not loaded! Check your script tags.");
        return;
    }

    const URL = "my_model/";

    // Hier kun je jouw classes aan geluiden en afbeeldingen koppelen

    const sounds = {
        "Mars": new Audio("my_sounds/mars.mp3"),
        "Snickers": new Audio("my_sounds/snickers.mp3"),
        "Milkyway": new Audio("my_sounds/milkyway.mp3")
    };

    const images = {
        "Mars": "my_images/mars.png",
        "Snickers": "my_images/snickers.png",
        "Milkyway": "my_images/milkyway.png",
        "Neutral": "my_images/neutraal.png"
    };

    // ---

    let model = null, webcam = null;
    const confidenceThreshold = 0.9; 
    const maxThreshold = 1.0;        
    const holdTime = 2000;            
    const cooldown = 4000;            
    const bufferSize = 5;             
    const displayHoldDuration = 5000; 
    const neutralHoldDuration = 500;  

    const holdStart = {};             
    const lastPlayed = {};
    const predictionBuffer = {};      
    let currentDetectedClass = null;
    let lastDetectionTime = 0;
    let lastNeutralTime = 0;

    const imageDiv = document.getElementById("image-display");
    imageDiv.innerHTML = `<img src="${images["Neutral"]}" alt="Neutral">`;

    try {
        webcam = new tmImage.Webcam(400, 300, true, { facingMode: "user" });
        await webcam.setup();
        await webcam.play();
        document.getElementById("webcam-container").appendChild(webcam.canvas);
        console.log("Webcam ready!");
    } catch (err) {
        console.error("Webcam initialization failed:", err);
        return;
    }

    try {
        model = await tmImage.load(URL + "model.json", URL + "metadata.json");
        console.log("Model loaded!");
    } catch (err) {
        console.error("Model loading failed:", err);
        model = null;
    }

    async function loop() {
        webcam.update();
        if (model) await predict();
        requestAnimationFrame(loop);
    }

    async function predict() {
        try {
            const prediction = await model.predict(webcam.canvas);

            let highest = prediction.reduce((a, b) => a.probability > b.probability ? a : b);
            const className = highest.className;
            const prob = highest.probability;

            if (!predictionBuffer[className]) predictionBuffer[className] = [];
            predictionBuffer[className].push(prob);
            if (predictionBuffer[className].length > bufferSize) predictionBuffer[className].shift();
            const avgProb = predictionBuffer[className].reduce((a, b) => a + b, 0) / predictionBuffer[className].length;

            const now = Date.now();

            if (currentDetectedClass && now - lastDetectionTime < displayHoldDuration) {
                document.getElementById("prediction").innerText = `Detected: ${currentDetectedClass}`;
                return;
            }

            if (avgProb < confidenceThreshold) {
                if (!currentDetectedClass || now - lastNeutralTime > neutralHoldDuration) {
                    document.getElementById("prediction").innerText = "No detection";
                    imageDiv.innerHTML = `<img src="${images["Neutral"]}" alt="Neutral">`;
                    currentDetectedClass = null;
                    lastNeutralTime = now;
                }
                return;
            }

            document.getElementById("prediction").innerText =
                `Detected: ${className} (${(avgProb*100).toFixed(2)}%)`;

            if (sounds[className] && avgProb >= confidenceThreshold && avgProb <= maxThreshold) {
                if (!holdStart[className]) holdStart[className] = now;

                if (now - holdStart[className] >= holdTime) {
                    if (!lastPlayed[className] || now - lastPlayed[className] > cooldown) {
                        sounds[className].play();
                        lastPlayed[className] = now;

                        imageDiv.innerHTML = `<img src="${images[className]}" alt="${className}">`;
                        currentDetectedClass = className;
                        lastDetectionTime = now;
                    }
                    holdStart[className] = null;
                }
            } else {
                holdStart[className] = null;
            }

        } catch (err) {
            console.error("Prediction failed:", err);
        }
    }

    loop();
})();