import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { apiClient } from '../api/client';
import { setAccessToken } from '../api/authStore';
import { SmokeType } from '../components/ui/SmokeType';
import type { components } from '../api/schema';

type LoginRequest = components['schemas']['LoginRequest'];

/* ────────────────────────────────────────────────────────────────────────────
 * Safe Error Message Extraction
 * ──────────────────────────────────────────────────────────────────────────── */
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string') return first.msg;
    }
    if (typeof detail === 'object' && detail !== null && 'message' in detail) {
      const message = (detail as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  return fallback;
};

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();

  /* ─ Form State ─ */
  const [email, setEmail] = useState('admin@college.edu');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  /* ─ Toast State ─ */
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('Authenticating staff credentials...');
  const [toastIsSuccess, setToastIsSuccess] = useState(true);
  const toastTimerRef = useRef<number | null>(null);

  /* ─ DOM Refs ─ */
  const containerRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  /* ─ Physics Coordinates ─ */
  const mouse = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const ringPos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const cardTiltTarget = useRef({ x: 0, y: 0 });
  const cardTiltCurrent = useRef({ x: 0, y: 0 });

  /* ─ Toast trigger ─ */
  const triggerToast = useCallback((msg: string, success: boolean = true) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    setToastIsSuccess(success);
    setToastVisible(true);

    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 3500);
  }, []);

  /* ──────────────────────────────────────────────────────────────────────────
   * 1. Fluid Magnetic Cursor Lerp (60 FPS smooth dampening)
   * ────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let animId: number;

    const onPointerMove = (e: PointerEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;

      if (dotRef.current) {
        dotRef.current.style.left = `${e.clientX}px`;
        dotRef.current.style.top = `${e.clientY}px`;
      }

      document.documentElement.style.setProperty('--mouse-x', `${e.clientX}px`);
      document.documentElement.style.setProperty('--mouse-y', `${e.clientY}px`);

      // 3D Card tilt calculation
      const card = cardRef.current;
      if (card) {
        const rect = card.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;

        card.style.setProperty('--card-px', `${px}px`);
        card.style.setProperty('--card-py', `${py}px`);

        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const distX = (px - centerX) / centerX;
        const distY = (py - centerY) / centerY;

        const maxTilt = 5.0;
        cardTiltTarget.current.x = Math.max(Math.min(-distY * maxTilt, maxTilt), -maxTilt);
        cardTiltTarget.current.y = Math.max(Math.min(distX * maxTilt, maxTilt), -maxTilt);

        if (px >= 0 && px <= rect.width && py >= 0 && py <= rect.height) {
          card.style.setProperty('--sheen-opacity', '1');
        } else {
          card.style.setProperty('--sheen-opacity', '0.25');
        }
      }
    };

    const renderCursor = () => {
      ringPos.current.x += (mouse.current.x - ringPos.current.x) * 0.18;
      ringPos.current.y += (mouse.current.y - ringPos.current.y) * 0.18;

      if (ringRef.current) {
        ringRef.current.style.left = `${ringPos.current.x}px`;
        ringRef.current.style.top = `${ringPos.current.y}px`;
      }
      animId = requestAnimationFrame(renderCursor);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    animId = requestAnimationFrame(renderCursor);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(animId);
    };
  }, []);

  /* ──────────────────────────────────────────────────────────────────────────
   * 2. 3D Card Tilt Physics Loop
   * ────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let animId: number;

    const renderCardPhysics = () => {
      cardTiltCurrent.current.x += (cardTiltTarget.current.x - cardTiltCurrent.current.x) * 0.12;
      cardTiltCurrent.current.y += (cardTiltTarget.current.y - cardTiltCurrent.current.y) * 0.12;

      if (cardRef.current) {
        cardRef.current.style.setProperty(
          '--card-tilt-x',
          `${cardTiltCurrent.current.x.toFixed(2)}deg`,
        );
        cardRef.current.style.setProperty(
          '--card-tilt-y',
          `${cardTiltCurrent.current.y.toFixed(2)}deg`,
        );
      }

      animId = requestAnimationFrame(renderCardPhysics);
    };

    animId = requestAnimationFrame(renderCardPhysics);

    const card = cardRef.current;
    const onLeave = () => {
      cardTiltTarget.current.x = 0;
      cardTiltTarget.current.y = 0;
      card?.style.setProperty('--sheen-opacity', '0');
    };

    card?.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(animId);
      card?.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  /* ── Cursor Hover Active Classes ── */
  const onHoverEnter = () => containerRef.current?.classList.add('cursor-active');
  const onHoverLeave = () => containerRef.current?.classList.remove('cursor-active');

  /* ── Caps-Lock Detection ── */
  const handleKeyEvent = (e: React.KeyboardEvent) => {
    if (e.getModifierState) {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  /* ──────────────────────────────────────────────────────────────────────────
   * 3. Real Authentication Protocol Handler
   * ────────────────────────────────────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setIsSuccess(false);

    const body: LoginRequest = {
      email,
      password,
    };

    try {
      const { data: token, error } = await apiClient.POST('/api/auth/login', {
        body,
      });

      if (error || !token) {
        const message = extractErrorMessage(error, 'Could not sign in.');
        triggerToast(message, false);
        setIsSubmitting(false);
        return;
      }

      setAccessToken(token.access_token);
      setIsSuccess(true);
      triggerToast(`Authenticated as ${email}. Launching timetable console...`, true);

      setTimeout(() => {
        navigate({ to: '/' });
      }, 1200);
    } catch (_err: unknown) {
      triggerToast('Could not sign in. Please verify your credentials.', false);
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="login-custom-cursor-root min-h-dvh flex items-center justify-center p-5 sm:p-8 md:p-14 relative overflow-x-hidden overflow-y-auto selection:bg-blue-500/30 selection:text-white bg-[#02050f]"
      style={{
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* =========================================================================
           CUSTOM HARDWARE-ACCELERATED LERP CURSOR
           ========================================================================= */}
      <div id="cursorDot" ref={dotRef} className="custom-cursor cursor-dot"></div>
      <div id="cursorRing" ref={ringRef} className="custom-cursor cursor-ring"></div>

      {/* =========================================================================
           BACKGROUND SYSTEM: Enhanced DMCE Building with Rooftop "D M C E" Sign
           ========================================================================= */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        {/* DMCE High-Resolution Enhanced Building Background */}
        <div
          id="bgPhoto"
          className="absolute inset-0 college-backdrop"
          style={{ backgroundImage: "url('/dmce-building.jpg')" }}
        ></div>

        {/* Multi-Stop Atmospheric Shadow Wash — Keeping rooftop red DMCE sign visible */}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#02050e] via-[#030816]/80 to-[#020612]/75"></div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_transparent_10%,_#02050e_85%)]"></div>

        {/* Soft Indigo Architectural Wash */}
        <div className="absolute inset-0 bg-blue-950/20 mix-blend-color"></div>

        {/* Physical 35mm Film Grain Texture */}
        <div className="absolute inset-0 film-grain"></div>

        {/* Atmospheric Floating Lighting Orbs */}
        <div
          className="absolute -top-32 -left-24 w-[34rem] h-[34rem] bg-blue-600/15 rounded-full blur-[140px] animate-pulse"
          style={{ animationDuration: '9s' }}
        ></div>
        <div
          className="absolute -bottom-36 -right-24 w-[38rem] h-[38rem] bg-indigo-500/15 rounded-full blur-[160px] animate-pulse"
          style={{ animationDuration: '12s' }}
        ></div>
      </div>

      {/* Mouse Tracking Global Ambient Torchlight */}
      <div className="fixed inset-0 z-10 pointer-events-none global-torch"></div>

      {/* =========================================================================
           MAIN GRID: Left Hero + Right Master-Tier Auth Box
           ========================================================================= */}
      <main className="relative z-20 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
        {/* =======================================================================
             LEFT COLUMN: Refined DMCE Brand Mark + Smoke Type Headline
             ======================================================================= */}
        <div className="lg:col-span-7 flex flex-col justify-center space-y-7 lg:pr-6">

          {/* 1. Refined, Proportional DMCE Brand Mark (No excessive borders, clean & elegant) */}
          <div className="spring-in delay-1 flex items-center space-x-4">
            <div
              id="dmceEmblem"
              className="relative p-2 rounded-2xl bg-slate-900/80 border border-white/15 backdrop-blur-xl shadow-xl shadow-blue-950/40 transition-transform duration-300 hover:scale-105"
              onMouseEnter={onHoverEnter}
              onMouseLeave={onHoverLeave}
            >
              <img
                src="/dmce-logo.png"
                alt="DMCE Official Emblem"
                className="w-12 h-12 sm:w-14 sm:h-14 object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
              />
            </div>

            {/* Department Badge: Sleek Technical Chip Alternative (Replaced green dot) */}
            <div
              className="inline-flex items-center space-x-2.5 px-3.5 py-2 rounded-xl bg-slate-900/85 border border-white/10 backdrop-blur-md shadow-lg shadow-black/20"
              onMouseEnter={onHoverEnter}
              onMouseLeave={onHoverLeave}
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-md bg-blue-500/20 border border-blue-400/40 text-blue-400">
                {/* Tech Microchip Glyph */}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                  <line x1="9" y1="1" x2="9" y2="4" />
                  <line x1="15" y1="1" x2="15" y2="4" />
                  <line x1="9" y1="20" x2="9" y2="23" />
                  <line x1="15" y1="20" x2="15" y2="23" />
                  <line x1="20" y1="9" x2="23" y2="9" />
                  <line x1="20" y1="15" x2="23" y2="15" />
                  <line x1="1" y1="9" x2="4" y2="9" />
                  <line x1="1" y1="15" x2="4" y2="15" />
                </svg>
              </span>
              <span className="font-mono text-xs font-bold text-slate-200 tracking-wider uppercase">
                Dept. of Information Technology
              </span>
            </div>
          </div>

          {/* 2. Smoke Type Component (React Bits Pro): Condensing out of drifting smoke */}
          <div className="spring-in delay-2 space-y-1">
            <SmokeType
              text="DMCE Timetable"
              fontSize="clamp(2.6rem, 5.5vw, 4rem)"
              fontWeight={800}
              letterSpacing="-0.04em"
              color="#ffffff"
              smokeColor="#60a5fa"
              delay={0.12}
              duration={0.9}
              stagger={0.06}
              rise={0.9}
              turbulence={1.2}
              replayOnHover={true}
              badge={
                <span className="erp-glow font-black tracking-tight text-3xl sm:text-4xl lg:text-[3.25rem] drop-shadow-[0_0_35px_rgba(59,130,246,0.7)] ml-2">
                  ERP
                </span>
              }
            />
          </div>

          {/* 3. Punchy Tagline with Strong Font Styling */}
          <div className="spring-in delay-3 pt-1">
            <p className="text-base sm:text-lg text-slate-300 font-normal leading-relaxed max-w-lg tracking-tight">
              Schedules, rooms and faculty.
              <span className="block text-white font-extrabold text-lg sm:text-xl tracking-tight mt-0.5">
                One place.
              </span>
            </p>
          </div>

          {/* 4. Quick Architecture Info Strip */}
          <div className="spring-in delay-4 flex items-center gap-2 pt-2 text-xs text-slate-400 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
            <span>Airoli Campus Console</span>
          </div>
        </div>

        {/* =======================================================================
             RIGHT COLUMN: Master-Tier Enhanced Glassmorphic Login Box
             ======================================================================= */}
        <div className="lg:col-span-5 flex justify-center lg:justify-end">
          <div className="tilt-card-wrapper w-full max-w-[430px]">
            <div
              id="authCard"
              ref={cardRef}
              className="tilt-card spring-in delay-3 p-8 sm:p-10 relative overflow-hidden"
              style={{
                boxShadow:
                  '0 30px 80px -20px rgba(0, 0, 0, 0.95), 0 0 45px -5px rgba(37, 99, 235, 0.25), inset 0 1px 1px 0 rgba(255, 255, 255, 0.16)',
              }}
            >
              {/* Specular Glare Sheen Layer */}
              <div className="specular-glare"></div>

              {/* Top Security Header Badge */}
              <div className="relative z-10 flex items-center justify-between mb-7 pb-4 border-b border-white/[0.08]">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-400/20 text-[10px] font-mono font-bold tracking-wider text-blue-300 uppercase">
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>SECURE GATEWAY</span>
                </div>

                <span className="font-mono text-[10px] text-slate-400 font-medium tracking-tight">
                  STAFF PORTAL
                </span>
              </div>

              {/* Card Header: Title & Subtitle with Strong Typography */}
              <div className="relative z-10 space-y-1.5 mb-7">
                <h2 className="text-2xl sm:text-[28px] font-extrabold text-white tracking-tight">
                  Sign in
                </h2>
                <p className="text-xs sm:text-[13px] text-slate-300 font-medium leading-relaxed">
                  Use your staff account to access the timetable console.
                </p>
              </div>

              {/* Enhanced Auth Form */}
              <form id="authForm" className="relative z-10 space-y-5" onSubmit={handleSubmit}>
                {/* ── EMAIL FIELD ── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="emailInput"
                      className="block font-mono text-[11px] font-bold tracking-wider text-slate-200 uppercase"
                    >
                      STAFF EMAIL <span className="text-blue-400">*</span>
                    </label>
                  </div>

                  <div
                    className="relative group transition-all duration-200"
                    onMouseEnter={onHoverEnter}
                    onMouseLeave={onHoverLeave}
                  >
                    {/* Left Icon (Envelope / User) */}
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-400 transition-colors">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </div>

                    <input
                      type="email"
                      id="emailInput"
                      required
                      autoFocus
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@college.edu"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/70 hover:bg-slate-950/90 focus:bg-slate-950 border border-white/[0.12] hover:border-white/[0.22] focus:border-blue-500 text-sm font-medium text-slate-100 placeholder-slate-500 outline-none transition-all duration-200 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] focus:ring-4 focus:ring-blue-500/20 focus:shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                    />
                  </div>
                </div>

                {/* ── PASSWORD FIELD ── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="passwordInput"
                      className="block font-mono text-[11px] font-bold tracking-wider text-slate-200 uppercase"
                    >
                      PASSWORD <span className="text-blue-400">*</span>
                    </label>

                    {/* Caps Lock Warning Tag */}
                    <span
                      id="capsBadge"
                      className={`${
                        capsLockOn ? 'inline-flex' : 'hidden'
                      } items-center space-x-1 font-mono text-[10px] font-bold text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-md border border-amber-500/30`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span>CAPS ON</span>
                    </span>
                  </div>

                  <div
                    className="relative group transition-all duration-200"
                    onMouseEnter={onHoverEnter}
                    onMouseLeave={onHoverLeave}
                  >
                    {/* Left Icon (Security Lock) */}
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-400 transition-colors">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>

                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="passwordInput"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handleKeyEvent}
                      onKeyUp={handleKeyEvent}
                      onBlur={() => setCapsLockOn(false)}
                      placeholder="Enter staff password"
                      className="w-full pl-10 pr-11 py-3 rounded-xl bg-slate-950/70 hover:bg-slate-950/90 focus:bg-slate-950 border border-white/[0.12] hover:border-white/[0.22] focus:border-blue-500 text-sm font-medium text-slate-100 placeholder-slate-500 outline-none transition-all duration-200 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] focus:ring-4 focus:ring-blue-500/20 focus:shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                    />

                    {/* Eye Toggle Button */}
                    <button
                      type="button"
                      id="togglePasswordBtn"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label="Toggle password visibility"
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-white transition-colors"
                      onMouseEnter={onHoverEnter}
                      onMouseLeave={onHoverLeave}
                    >
                      {showPassword ? (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.8"
                            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.8"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.8"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* ── ENHANCED CTA BUTTON ── */}
                <div className="pt-2">
                  <button
                    type="submit"
                    id="submitBtn"
                    disabled={isSubmitting || isSuccess}
                    className={`shimmer-btn w-full py-3.5 px-4 rounded-xl text-white font-bold text-sm border transition-all duration-200 flex items-center justify-center space-x-2 disabled:cursor-not-allowed ${
                      isSuccess
                        ? 'bg-gradient-to-r from-blue-600 via-sky-500 to-indigo-600 shadow-[0_0_30px_rgba(56,189,248,0.55)] border-sky-400/50'
                        : isSubmitting
                          ? 'bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-800 shadow-[0_0_24px_rgba(37,99,235,0.4)] border-blue-400/30'
                          : 'bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.985] shadow-[0_0_26px_rgba(37,99,235,0.45)] hover:shadow-[0_0_38px_rgba(37,99,235,0.65)] border-blue-400/40'
                    }`}
                    onMouseEnter={onHoverEnter}
                    onMouseLeave={onHoverLeave}
                  >
                    {isSubmitting ? (
                      <>
                        <svg
                          id="btnSpinner"
                          className="w-4 h-4 animate-spin text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                          ></path>
                        </svg>
                        <span id="btnText" className="tracking-wide">
                          Authorizing staff credentials...
                        </span>
                      </>
                    ) : isSuccess ? (
                      <>
                        <svg
                          id="btnSuccess"
                          className="w-4 h-4 text-sky-200"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span id="btnText" className="tracking-wide">
                          Session Authorized
                        </span>
                      </>
                    ) : (
                      <span id="btnText" className="tracking-wide">
                        Sign in
                      </span>
                    )}
                  </button>
                </div>
              </form>

              {/* Card Footer Note with Security Assurance */}
              <div className="relative z-10 mt-7 pt-5 border-t border-white/[0.08] text-center space-y-1">
                <p className="text-xs text-slate-400 font-medium leading-relaxed">
                  Accounts are created by the academic administrator.
                </p>
                <p className="text-[10px] font-mono text-slate-400 tracking-tight">
                  Official DMCE Timetable ERP System • v2.4
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* =========================================================================
           DYNAMIC FLOATING TOAST NOTIFICATION
           ========================================================================= */}
      <div
        id="portalToast"
        className={`fixed bottom-7 left-1/2 -translate-x-1/2 z-50 transition-all duration-400 px-5 py-3 rounded-2xl bg-slate-900/90 border border-white/10 text-xs font-medium text-slate-200 backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex items-center space-x-3 ${
          toastVisible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        <div
          id="toastIndicator"
          className={`w-2 h-2 rounded-full ${
            toastIsSuccess
              ? 'bg-sky-400 shadow-[0_0_8px_#38bdf8]'
              : 'bg-rose-400 shadow-[0_0_8px_#f43f5e]'
          }`}
        ></div>
        <span id="toastMessage">{toastMessage}</span>
      </div>
    </div>
  );
};
