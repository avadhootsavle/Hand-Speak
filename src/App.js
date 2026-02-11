import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

const fallbackClassify = (landmarks) => {
  if (!landmarks || !landmarks.length) return 'No hand seen';
  const hand = landmarks;
  const isExtended = (tip, pip) => hand[tip].y < hand[pip].y - 0.02;
  const thumbExtended =
    Math.abs(hand[4].x - hand[2].x) > Math.abs(hand[3].x - hand[1].x);
  const fingersExtended = [
    thumbExtended,
    isExtended(8, 6),
    isExtended(12, 10),
    isExtended(16, 14),
    isExtended(20, 18),
  ];
  const count = fingersExtended.filter(Boolean).length;
  if (count === 0) return 'Fist';
  if (count === 1) return 'One finger';
  if (count === 2) return 'Two fingers';
  if (count === 3) return 'Three fingers';
  if (count === 4) return 'Four fingers';
  if (count === 5) return 'Open palm';
  return 'Hand detected';
};

const drawLandmarks = (canvas, landmarks) => {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks || !landmarks.length) return;
  const points = landmarks[0];
  ctx.strokeStyle = '#7ae582';
  ctx.fillStyle = '#7ae582';
  ctx.lineWidth = 2.5;
  points.forEach((point) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
  });
};

const gestureFriendlyNames = {
  thumb_up: 'Thumbs up / Yes',
  thumb_down: 'Thumbs down / No',
  open_palm: 'Open palm / Stop',
  closed_fist: 'Closed fist / Ready',
  pointing_up: 'Point up / Attention',
  victory: 'Victory / Peace',
  i_love_you: 'I love you',
  iloveyou: 'I love you',
  ok_sign: 'OK sign',
  call_me: 'Call me',
  rock: 'Rock on',
  flex: 'Flex / Strong',
};

const gestureToMove = (label) => {
  const lower = (label || '').toLowerCase();
  if (lower.includes('closed_fist') || lower.includes('fist') || lower.includes('rock')) {
    return 'Rock';
  }
  if (lower.includes('open_palm') || lower.includes('palm') || lower.includes('open')) {
    return 'Paper';
  }
  if (lower.includes('victory') || lower.includes('two') || lower.includes('pointing_up')) {
    return 'Scissors';
  }
  return '';
};

const moveEmoji = {
  Rock: '✊',
  Paper: '✋',
  Scissors: '✌️',
};

const computeResult = (player, bot) => {
  if (!player || !bot) return '';
  if (player === bot) return 'Tie';
  if (
    (player === 'Rock' && bot === 'Scissors') ||
    (player === 'Paper' && bot === 'Rock') ||
    (player === 'Scissors' && bot === 'Paper')
  ) {
    return 'You win!';
  }
  return 'Bot wins';
};

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const recognizerRef = useRef(null);
  const animationRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState('Camera is off');
  const [modelStatus, setModelStatus] = useState('Model not loaded');
  const [detected, setDetected] = useState('—');
  const [latestMove, setLatestMove] = useState('');
  const [botMove, setBotMove] = useState('');
  const [result, setResult] = useState('');
  const [lockedMove, setLockedMove] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const countdownRef = useRef(0);
  const [error, setError] = useState('');
  const currentPlayerMove = lockedMove || latestMove;
  const playerDisplay = moveEmoji[currentPlayerMove]
    ? `${moveEmoji[currentPlayerMove]} ${currentPlayerMove}`
    : 'Show Rock / Paper / Scissors';
  const botDisplay = moveEmoji[botMove] ? `${moveEmoji[botMove]} ${botMove}` : '—';

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);

  const startCamera = useCallback(async () => {
    setError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('This browser does not allow camera access here.');
      return;
    }
    try {
      setStatus('Requesting camera permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        setStatus('Camera ready');
      }
    } catch (err) {
      setError('Camera permission denied or unavailable.');
      setStatus('Camera is off');
    }
  }, []);

  const stopCamera = useCallback(() => {
    const tracks = videoRef.current?.srcObject?.getTracks() || [];
    tracks.forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    recognizerRef.current?.close?.();
    recognizerRef.current = null;
    setCameraActive(false);
    setDetected('—');
    setStatus('Camera is off');
    setModelStatus('Model not loaded');
  }, []);

  useEffect(() => {
    if (!cameraActive) return undefined;
    let cancelled = false;
    const assetPrefix = process.env.PUBLIC_URL || '';
    const localWasmPath = `${assetPrefix}/mediapipe/wasm`;
    const localModelPath = `${assetPrefix}/mediapipe/gesture_recognizer.task`;

    const loadModelAndRun = async () => {
      try {
        setModelStatus('Loading gesture model (first load may take a few seconds)...');
        const vision = await import('@mediapipe/tasks-vision');
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(localWasmPath).catch(
          async (err) => {
            console.warn('Local WASM not found, falling back to CDN.', err);
            return vision.FilesetResolver.forVisionTasks(
              'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
            );
          },
        );
        const gestureRecognizer = await vision.GestureRecognizer.createFromOptions(
          filesetResolver,
          {
            baseOptions: {
              modelAssetPath: localModelPath,
            },
            runningMode: 'VIDEO',
            numHands: 1,
          },
        ).catch(async (err) => {
          console.warn('Local model not found, falling back to CDN.', err);
          return vision.GestureRecognizer.createFromOptions(filesetResolver, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
            },
            runningMode: 'VIDEO',
            numHands: 1,
          });
        });

        if (cancelled) {
          gestureRecognizer.close();
          return;
        }

        recognizerRef.current = gestureRecognizer;
        setModelStatus('Model ready');

        const processFrame = () => {
          if (cancelled || !videoRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
          }

          const now = performance.now();
          const results = gestureRecognizer.recognizeForVideo(video, now);
          drawLandmarks(canvas, results?.landmarks);

          if (results?.landmarks?.length) {
            setStatus('Hand detected');
            const topGesture = results.gestures?.[0]?.[0];
            if (topGesture) {
              const label = topGesture.categoryName || 'Gesture';
              const score = Math.round((topGesture.score || 0) * 100);
              const friendly =
                gestureFriendlyNames[label.toLowerCase()] || label.replace(/_/g, ' ');
              setDetected(`${friendly} (${score}%)`);
              setLatestMove(gestureToMove(label));
              const isILoveYou =
                label.toLowerCase() === 'i_love_you' || label.toLowerCase() === 'iloveyou';
              if (isILoveYou && !playingRef.current && countdownRef.current === 0) {
                setBotMove('');
                setResult('');
                setLockedMove('');
                setCountdown(3);
                setPlaying(true);
              }
            } else {
              const fallback = fallbackClassify(results.landmarks[0]);
              setDetected(fallback);
              setLatestMove(gestureToMove(fallback));
            }
          } else {
            setStatus('Looking for a hand...');
            setDetected('No hand seen');
            setLatestMove('');
          }

          animationRef.current = requestAnimationFrame(processFrame);
        };

        processFrame();
      } catch (err) {
        console.error(err);
        setModelStatus('Model failed to load. Check your internet connection.');
      }
    };

    loadModelAndRun();

    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      recognizerRef.current?.close?.();
      recognizerRef.current = null;
    };
  }, [cameraActive]);

  const playBot = useCallback(() => {
    setBotMove('');
    setResult('');
    setLockedMove('');
    setCountdown(3);
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    if (countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown((c) => c - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }

    const moves = ['Rock', 'Paper', 'Scissors'];
    const finalPlayerMove = latestMove;
    const botChoice = moves[Math.floor(Math.random() * moves.length)];
    setLockedMove(finalPlayerMove);
    setBotMove(botChoice);
    setResult(finalPlayerMove ? computeResult(finalPlayerMove, botChoice) : 'No move detected');
    setPlaying(false);
    return undefined;
  }, [playing, countdown, latestMove]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Cam RPS · Hands-free duel</p>
          <h1>
            Rock. Paper. Scissors.<br />
            Play the bot with just your hand.
          </h1>
          <p className="byline">Created by Avadhoot Savle</p>
          <p className="lede">
            Show your move, watch the countdown, and see if you beat the bot. All in-browser; no
            uploads, just fun.
          </p>
          <div className="actions">
            <button onClick={startCamera} className="primary" disabled={cameraActive}>
              {cameraActive ? 'Camera running' : 'Start camera'}
            </button>
            <button onClick={stopCamera} className="ghost" disabled={!cameraActive}>
              Stop camera
            </button>
          </div>
          <div className="status-row">
            <span className="pill">{status}</span>
            <span className="pill pill-ghost">{modelStatus}</span>
          </div>
          {error ? <p className="error">{error}</p> : null}
        </div>
      </header>

      <main className="grid">
        <section className="panel video-panel">
          <div className="video-shell">
            <video ref={videoRef} autoPlay playsInline muted />
            <canvas ref={canvasRef} />
            {!cameraActive ? (
              <div className="overlay">
                <p>Enable the camera to begin.</p>
              </div>
            ) : null}
          </div>
          <p className="hint">
            No recording or upload. Processing stays in your browser. Use a fist for Rock, open palm
            for Paper, V sign for Scissors. Flash "I love you" to auto-start.
          </p>
        </section>

        <section className="panel">
          <div className="detected">
            <p className="label">Detected meaning</p>
            <p className="detected-text">{detected}</p>
          </div>
          <div className="rps">
            <div className="rps-row">
              <div className="rps-card">
                <p className="label">Your move</p>
                <p className="rps-graphic">{playerDisplay}</p>
                <p className="rps-sub">
                  Keep your hand centered and steady for a second so we can lock it in.
                </p>
              </div>
              <div className="rps-card">
                <p className="label">Bot move</p>
                <p className="rps-graphic bot-graphic">{botDisplay}</p>
                <p className="rps-sub">Bot picks after the countdown.</p>
              </div>
              <div className="rps-card result-card">
                <p className="label">Result</p>
                <p className="rps-result">{result || 'Waiting to play'}</p>
                <p className="rps-sub">Best of luck!</p>
              </div>
            </div>
            <div className="rps-actions">
              <button
                className="primary"
                onClick={playBot}
                disabled={playing}
                title={playing ? 'Countdown running' : 'Start countdown'}
              >
                Play vs bot
              </button>
              {playing ? <span className="countdown-pill">{countdown || 'Go!'}</span> : null}
              <p className="hint">
                Show a closed fist for Rock, open palm for Paper, and a V sign for Scissors. Flash
                an "I love you" sign to auto-start the countdown.
              </p>
            </div>
            <div className="gesture-help">
              <div className="chip">Closed fist → Rock</div>
              <div className="chip">Open palm → Paper</div>
              <div className="chip">V sign / Victory → Scissors</div>
            </div>
          </div>
        </section>
      </main>

      <section className="panel about">
        <p className="label">About</p>
        <p className="about-title">Cam RPS — camera rock-paper-scissors</p>
        <p className="about-text">
          This mini-game uses MediaPipe&apos;s on-device hand gesture model to read your move, then
          throws down against a bot. Everything runs locally in your browser; no footage is saved or
          sent anywhere.
        </p>
        <p className="about-text">
          Tips: bright light, one hand near the frame center, steady for a second before the
          countdown hits zero.
        </p>
      </section>

      <footer className="footer">
        <p>
          Quick tips: good lighting, clear background, and hold the sign until the countdown ends.
          Accuracy may vary—play again if it misses.
        </p>
      </footer>
    </div>
  );
}

export default App;
