// Face recognition in the browser (face-api.js). The photo never leaves the device: only 128 numbers do.
// To work offline or avoid the CDN, download the library and the /model folder from the package below
// and point LIB and MODELS at your own copy (for example /vendor/face-api.js and /vendor/models/).
const FaceKit = (() => {
  const VER = '1.7.12';
  const LIB = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VER}/dist/face-api.js`;
  const MODELS = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VER}/model/`;
  let ready = null;

  const script = src => new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = src; s.onload = ok;
    s.onerror = () => bad(new Error('Could not load the face recognition library. Check the internet connection.'));
    document.head.appendChild(s);
  });

  // Loads the library and the three small models once per page.
  function load() {
    return ready || (ready = (async () => {
      if (!window.faceapi) await script(LIB);
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODELS),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELS)
      ]);
    })().catch(e => { ready = null; throw e; }));
  }

  async function camera(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('The camera needs https or localhost.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); }
    catch { throw new Error('Camera unavailable. Allow camera access in the browser and try again.'); }
    video.srcObject = stream; await video.play();
    return stream;
  }
  const stop = s => { if (s) s.getTracks().forEach(t => t.stop()); };

  // Every face in the frame, biggest (closest) first, each with its 128-number descriptor.
  async function detect(video) {
    const r = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptors();
    return r.sort((a, b) => b.detection.box.area - a.detection.box.area);
  }

  // Plain-language reason a capture is not good enough, or null when it is fine.
  function problem(faces, video) {
    if (!faces.length) return 'No face found. Face the camera in good light.';
    if (faces.length > 1) return 'Only one person should be in view.';
    if (faces[0].detection.score < 0.6) return 'The face is not clear enough. Check the lighting and look straight ahead.';
    if (faces[0].detection.box.width < video.videoWidth * 0.15) return 'Move a little closer to the camera.';
    return null;
  }

  // Averaging a few frames smooths out noise and makes matching steadier.
  const avg = list => list[0].map((_, i) => list.reduce((s, v) => s + v[i], 0) / list.length);

  return { load, camera, stop, detect, problem, avg };
})();
