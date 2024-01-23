import paper, { Path } from 'paper';
import axios from 'axios';
const API_URL = 'https://4ydvn55lh72mjo-4000.proxy.runpod.net/process-image';
// const API_URL = 'http://127.0.0.1:4000/process-image';
// ngrok http 8080 --host-header="localhost:8080"

let paths = [];
let boundingBoxPath = null;
let currentBoundingBox = null;

const storageKey = 'paperJsSketch';
let lastDragTime = 0;
const strokeActiveColor = 'red'; 
let sketchSendInterval;


// ----------------------------- CONTROLS -----------------------------
const dat = require('dat.gui');

let canvas_width = window.innerWidth;
let canvas_height = (window.innerHeight / 2);
let prompt = 'creature'
let stroke_width = 1.0;

let controls = {
    'Prompt': prompt,
    'Stroke width': stroke_width,
};

let gui = new dat.GUI();
gui.add(controls, 'Prompt')
gui.add(controls, 'Stroke width', 1.0, 10).step(0.1)
gui.close();


// ------------------------------ CANVAS ------------------------------

paper.install(window);
paper.setup(document.getElementById('canvas-sketch'));
let tool = new paper.Tool(); // to handle mouse events

// Throttling function
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Function to handle sketch sending
function handleSketchSending() {
    let sketch_img = exportSketchAsImage();
    if (sketch_img) {
        sendSketchToServer(sketch_img);
    }
}

function updateBoundingBox(path) {
    let pathBounds = path.strokeBounds;
    if (path && path.segments.length > 0) {

        let size = paper.view.bounds.height;
        let pathCenterX = pathBounds.center.x;

        // Adjust the bounding box to be centered on pathCenterX
        let leftEdge = pathCenterX - size / 2;
        if (leftEdge < 0) {
            leftEdge = 0;
        } else if (leftEdge + size > paper.view.bounds.width) {
            leftEdge = paper.view.bounds.width - size;
        }

        // Create the square bounding box
        let squareBBox = new paper.Rectangle(leftEdge, 0, size, size);
        currentBoundingBox = squareBBox;

        // Update the visual bounding box
        if (boundingBoxPath) {
            boundingBoxPath.remove(); // Remove the old box
        }

        boundingBoxPath = new paper.Path.Rectangle({
            rectangle: squareBBox,
            strokeColor: 'white',
            strokeWidth: 1,
            dashArray: [5, 5],
            fillColor: new paper.Color(1, 0, 0, 0.0) // Semi-transparent red fill
        });

        boundingBoxPath.bringToFront();
    }
}

function saveSketchToCache() {
    if (paper.project) {
        const sketchData = paper.project.exportJSON();
        localStorage.setItem(storageKey, sketchData);
    }
}

function loadSketchFromCache() {
    const sketchData = localStorage.getItem(storageKey);
    if (sketchData) {
        // Debugging: log the raw data from localStorage
        console.log('Loaded sketch data from cache:', sketchData);

        paper.project.clear(); // Ensure the project is clear before importing
        paper.project.importJSON(sketchData);

        // Debugging: log the paths after importing
        console.log('Paths after import:', paper.project.activeLayer.children);

        // Rebuild your paths array or any other state you're tracking
        paths = paper.project.activeLayer.children.map(child => child);
    }
}

function resetBoundingBox() {
    if (boundingBoxPath) {
        boundingBoxPath.remove();
        boundingBoxPath = null;
    }
}

function initializeDrawing() {
    loadSketchFromCache();
    resetBoundingBox()

    var path;

    //// NEW:
    tool.onMouseDown = (event) => {
        if (path) {
            path.selected = false;
        }
        path = new Path({
            segments: [event.point],
            strokeColor: strokeActiveColor,
            strokeWidth: controls['Stroke width']
        });
    }

    const throttledSendSketch = throttle(handleSketchSending, 1000);

    // Integrate with onMouseDrag
    tool.onMouseDrag = (event) => {
        if (path) {
            path.add(event.point);
            path.strokeColor = 'white';
            updateBoundingBox(path);
            // throttledSendSketch();
        }
    };

    tool.onMouseUp = () => {
        path.simplify(5);
        paths.push(path);
        saveSketchToCache();
        // Stop sending sketches and send the final sketch
        clearInterval(sketchSendInterval);
        let sketch_img = exportSketchAsImage();
        if (sketch_img) {
            sendSketchToServer(sketch_img);
        }
    };
}

function exportSketchAsImage() {
    if (!boundingBoxPath) return; // If no bounding box, exit the function

    // Temporarily hide the bounding box before exporting
    boundingBoxPath.visible = false;
    paper.view.update();  // Apply the visibility change

    let bbox = boundingBoxPath.strokeBounds; // Get the stroke bounds of the bounding box

    let sketchCanvas = document.createElement('canvas');
    sketchCanvas.width = sketchCanvas.height = 512;
    let ctx = sketchCanvas.getContext('2d');

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, sketchCanvas.width, sketchCanvas.height);

    // Draw the bounded area onto the new canvas
    ctx.drawImage(
        document.getElementById('canvas-sketch'),
        bbox.x, bbox.y, bbox.width, bbox.height,
        0, 0, 512, 512
    );

    // Make the bounding box visible again
    boundingBoxPath.visible = true;
    paper.view.update();

    return sketchCanvas.toDataURL('image/png');
}


function initializeCanvases() {
    var sketchCanvas = document.getElementById('canvas-sketch');
    var renderCanvas = document.getElementById('canvas-render');
    
    if (sketchCanvas.getContext && renderCanvas.getContext) {
        // Set the size for the sketch canvas
        sketchCanvas.width = canvas_width
        sketchCanvas.height = canvas_height

        sketchCanvas.style.backgroundColor = 'black';

        // Fill the canvas with white background
        let ctx = renderCanvas.getContext('2d');
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

        // Set the size for the render canvas, ensure this is only done once to avoid clearing it
        renderCanvas.width = sketchCanvas.width;
        renderCanvas.height = sketchCanvas.height; // Make it the same size as the sketch canvas
    }
}


// ------------------------------ BACKEND ------------------------------

function sendSketchToServer(base64SketchImage) {
    let canvasRender = document.getElementById('canvas-render');
    let ctxRender = canvasRender.getContext('2d');

    let init_img_data = ctxRender.getImageData(currentBoundingBox.x, currentBoundingBox.y, currentBoundingBox.width, currentBoundingBox.height);
    let init_img_url = imageDataToDataURL(init_img_data);
    let prompt = `a digital art painting of SHDLN ${controls['Prompt']} on a black background`

    const payload = { 
        prompt: prompt,
        init_img: init_img_url.replace(/^data:image\/(png|jpg);base64,/, ''), 
        sketch_img: base64SketchImage.replace(/^data:image\/(png|jpg);base64,/, ''),
    };

    axios.post(API_URL, payload, { responseType: 'blob' })
        .then(response => {
            const url = URL.createObjectURL(new Blob([response.data], { type: 'image/png' }));
            renderImageOnCanvas(url, currentBoundingBox);
        })
        .catch(error => {
            console.error('Error sending sketch to server:', error);
        });
}


// ------------------------------- UTILS -------------------------------

function renderImageOnCanvas(url, bbox) {
    let img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
        let canvasRender = document.getElementById('canvas-render');
        let ctxRender = canvasRender.getContext('2d');

        let imageHeight = canvasRender.height;
        let imageWidth = imageHeight;

        let dx = bbox.x + (bbox.width - imageWidth) / 2;
        let dy = bbox.y + (bbox.height - imageHeight) / 2;

        ctxRender.drawImage(img, dx, dy, imageWidth, imageHeight);

        // Fade in settings
        // let opacity = 0;
        // const fadeInDuration = 1000; // Duration in milliseconds
        // const fadeInStep = 1 / (fadeInDuration / 1000 * 60); // Incremental step for opacity

        // function fadeIn() {
        //     ctxRender.globalAlpha = opacity;
        //     ctxRender.drawImage(img, dx, dy, imageWidth, imageHeight);

        //     // Increment opacity
        //     opacity += fadeInStep;
        //     if (opacity < 1) {
        //         requestAnimationFrame(fadeIn);
        //     } else {
        //         ctxRender.globalAlpha = 1; // Ensure final opacity is set to 1
        //     }
        // }

        // fadeIn();
    };
    img.src = url;
}


function imageDataToDataURL(imgData) {
    let canvas = document.createElement('canvas');
    canvas.width = imgData.width;
    canvas.height = imgData.height;

    // Get the context of the canvas
    let ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png');
}


// ------------------------------ EVENTS ------------------------------

document.addEventListener("DOMContentLoaded", function() {
    initializeCanvases();
    initializeDrawing(); 
});

// Adjust the resize handler to re-initialize the canvases with the new sizes
window.addEventListener('resize', initializeCanvases);

// Undo function that removes the last path
function undoLastPath() {
    if (paths.length > 0) {
        let lastPath = paths.pop();
        lastPath.remove();
        saveSketchToCache();
    }
}

// Event listener for keydown to listen for the undo shortcut
document.addEventListener('keydown', function(event) {
    // Check if 'Z' is pressed along with either Ctrl or Cmd (for MacOS)
    if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); // Prevent the default undo functionality
        undoLastPath();
    }
});

function clearCanvas() {
    // Remove all the paths from the project
    paper.project.activeLayer.removeChildren();
    paths = []; // Reset the paths array
    localStorage.removeItem(storageKey); // Clear the saved sketch data
    paper.view.draw(); // Update the canvas
}

document.addEventListener('keydown', function(event) {
    if (event.key.toLowerCase() === 'c') {
        clearCanvas();
    }
});