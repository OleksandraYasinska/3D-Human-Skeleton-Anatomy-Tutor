import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Елементи інтерфейсу
const container = document.getElementById('canvas-container');
const btnLearn = document.getElementById('btn-learn');
const btnExam = document.getElementById('btn-exam');
const btnStartExam = document.getElementById('start-exam');

const panelLearn = document.getElementById('panel-learn');
const panelExam = document.getElementById('panel-exam');

const boneNameUI = document.getElementById('bone-name');
const boneLatinUI = document.getElementById('bone-latin');
const boneDescUI = document.getElementById('bone-description');

const examQuestionUI = document.getElementById('exam-question');
const scoreUI = document.getElementById('score');
const mistakesUI = document.getElementById('mistakes');
const progressBar = document.getElementById('progress-bar');

// Глобальні змінні
let scene, camera, renderer, controls, skeletonModel;
let boneData = {};
let currentMode = 'learn';
let selectedObject = null;

// Стан іспиту
let examState = {
    targetBoneNameUA: null,
    correctAnswers: 0,
    mistakes: 0,
    maxQuestions: 12,
    active: false,
    questionsPool: []
};

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// таргет камери
const desiredTarget = new THREE.Vector3(0, 0, 0);

// Ініціалізація додатку
async function init() {
    try {
        const response = await fetch('data/bones.json');
        boneData = await response.json();
    } catch (e) {
        console.error("Помилка завантаження бази даних кісток");
        boneData = {};
    }

    setupScene();
    loadModel();
    setupEvents();
    animate();
}

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f0f0f);

    const isMobile = window.innerWidth <= 1024;
    
    // Збільшуємо FOV для мобільних (50 замість 40), щоб бачити більше по вертикалі
    camera = new THREE.PerspectiveCamera(isMobile ? 50 : 40, container.clientWidth / container.clientHeight, 0.1, 1000);
    
    // Відсуваємо камеру далі на мобільних, щоб скелет вліз повністю
    camera.position.set(0, 0, isMobile ? 20 : 14);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(5, 10, 7);
    scene.add(light);

    // НАЛАШТУВАННЯ КАМЕРИ ТА КЕРУВАННЯ
    controls = new OrbitControls(camera, renderer.domElement);
    
    // На мобільних зум до курсора може працювати некоректно, вимикаємо для тач-інтерфейсів
    controls.zoomToCursor = !isMobile; 
    
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    
    // Увімкнено панорамування (двома пальцями), щоб можна було підняти/опустити скелет
    controls.enablePan = true; 
    controls.panSpeed = 0.8;
    
    controls.enableZoom = true;
    controls.zoomSpeed = 1.0;
    controls.minDistance = 2;
    controls.maxDistance = 35; // Збільшено ліміт для мобільних
    
    controls.target.copy(desiredTarget);
    controls.update();
}

function loadModel() {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);

    loader.load('models/Skeleton.glb', (gltf) => {
        skeletonModel = gltf.scene;
        
        skeletonModel.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.6,
                    metalness: 0.1
                });
                child.userData.originalColor = child.material.color.clone();
            }
        });

        // АДАПТИВНА ВИСОТА: На мобільних опускаємо модель нижче, 
        // щоб центр мас був ближче до центру канвасу
        const isMobile = window.innerWidth <= 1024;
        skeletonModel.position.y = isMobile ? -6 : -3.8;

        scene.add(skeletonModel);

        const loaderUI = document.getElementById('loader');
        if (loaderUI) loaderUI.style.display = 'none';

    }, undefined, (error) => {
        console.error('Сталася помилка при завантаженні моделі:', error);
    });
}

function updateMouse(event) {
    const rect = container.getBoundingClientRect();
    // Використовуємо touches для мобільних або clientX для ПК
    const clientX = event.clientX || (event.touches && event.touches[0].clientX);
    const clientY = event.clientY || (event.touches && event.touches[0].clientY);
    
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function onPointerDown(event) {
    if (!skeletonModel) return;
    updateMouse(event);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(skeletonModel, true);

    if (hits.length > 0) {
        desiredTarget.copy(hits[0].point);

        if (currentMode === 'learn') {
            selectBone(hits[0].object);
        } else if (examState.active) {
            checkExamAnswer(hits[0].object);
        }
    }
}

// Навчання
function selectBone(obj) {
    if (selectedObject) selectedObject.material.color.copy(selectedObject.userData.originalColor);
    selectedObject = obj;
    obj.material.color.set(0x00d4ff);

    const data = boneData[obj.name] || { ua: obj.name, lat: '...', desc: 'Інформація відсутня' };
    boneNameUI.innerText = data.ua;
    boneLatinUI.innerText = data.lat;
    boneDescUI.innerText = data.desc;
}

// Іспит
function startExam() {
    const allUniqueNames = [...new Set(Object.values(boneData).map(b => b.ua))];
    
    examState = {
        targetBoneNameUA: null,
        correctAnswers: 0,
        mistakes: 0,
        maxQuestions: 12,
        active: true,
        questionsPool: allUniqueNames.sort(() => 0.5 - Math.random()).slice(0, 12)
    };

    btnStartExam.innerText = "Перескласти іспит";
    document.getElementById('result-screen').style.display = 'none';
    
    updateExamUI();
    nextExamQuestion();
}

function nextExamQuestion() {
    if (examState.questionsPool.length === 0) {
        finishExam(true);
        return;
    }
    examState.targetBoneNameUA = examState.questionsPool.pop();
    examQuestionUI.innerText = `Знайдіть: ${examState.targetBoneNameUA}`;
}

function checkExamAnswer(obj) {
    if (!examState.active) return;

    const clickedBoneInfo = boneData[obj.name];
    const clickedNameUA = clickedBoneInfo ? clickedBoneInfo.ua : null;

    if (clickedNameUA === examState.targetBoneNameUA) {
        examState.correctAnswers++;
        flashColor(obj, 0x00ff00);
        
        if (examState.correctAnswers >= examState.maxQuestions) {
            finishExam(true);
        } else {
            updateExamUI();
            nextExamQuestion();
        }
    } else {
        examState.mistakes++;
        flashColor(obj, 0xff0000);
        updateExamUI();

        if (examState.mistakes >= 4) {
            finishExam(false);
        }
    }
}

function updateExamUI() {
    scoreUI.innerText = examState.correctAnswers;
    mistakesUI.innerText = examState.mistakes;
    const progress = (examState.correctAnswers / examState.maxQuestions) * 100;
    progressBar.style.width = progress + "%";
}

function flashColor(obj, color) {
    const original = obj.userData.originalColor.clone();
    obj.material.color.set(color);
    setTimeout(() => { if (obj.material) obj.material.color.copy(original); }, 400);
}

function finishExam(success) {
    examState.active = false;
    btnStartExam.innerText = "Почати іспит";
    
    const screen = document.getElementById('result-screen');
    const title = document.getElementById('result-title');
    const scoreText = document.getElementById('result-score');

    screen.style.display = 'block';
    
    if (success) {
        title.innerText = "Іспит складено! 🎉";
        title.style.color = "#00ff00";
        scoreText.innerText = `Результат: ${examState.correctAnswers} з 12. Помилок: ${examState.mistakes}`;
    } else {
        title.innerText = "Не здано ❌";
        title.style.color = "#ff4444";
        scoreText.innerText = "Ви допустили 4 помилки. Спробуйте ще раз.";
    }
}

// Події
function setupEvents() {
    window.addEventListener('resize', onResize);
    // Використовуємо pointerdown для універсальної підтримки миші та тачу
    container.addEventListener('pointerdown', onPointerDown);

    btnLearn.onclick = () => switchMode('learn');
    btnExam.onclick = () => switchMode('exam');
    btnStartExam.onclick = startExam;

    const closeResult = document.getElementById('close-result');
    if(closeResult) closeResult.onclick = () => document.getElementById('result-screen').style.display = 'none';
}

function switchMode(mode) {
    currentMode = mode;
    
    btnLearn.classList.toggle('active', mode === 'learn');
    btnExam.classList.toggle('active', mode === 'exam');

    panelLearn.style.display = mode === 'learn' ? 'block' : 'none';
    panelExam.style.display = mode === 'exam' ? 'block' : 'none';
    
    if (selectedObject) {
        selectedObject.material.color.copy(selectedObject.userData.originalColor);
        selectedObject = null;
    }
}

function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;

    camera.aspect = w / h;

    // Динамічне коригування FOV: чим вужчий екран, тим більший кут огляду
    if (w < 600) {
        camera.fov = 55;
    } else if (w < 1024) {
        camera.fov = 50;
    } else {
        camera.fov = 40;
    }

    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

// Анімація
function animate() {
    requestAnimationFrame(animate);
    
    // Плавне слідування за таргетом
    if (controls.state === -1) {
        controls.target.lerp(desiredTarget, 0.1);
    } else {
        desiredTarget.copy(controls.target);
    }
    
    controls.update();
    renderer.render(scene, camera);
}

init();
