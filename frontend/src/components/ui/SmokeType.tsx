import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface SmokeTypeProps {
  text: string;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'div';
  fontSize?: string;
  fontWeight?: number | string;
  letterSpacing?: string;
  lineHeight?: number | string;
  color?: string;
  smokeColor?: string;
  delay?: number; // seconds
  duration?: number; // seconds
  stagger?: number; // seconds
  rise?: number; // em
  turbulence?: number; // 0 to 3
  replayOnHover?: boolean;
  className?: string;
  style?: React.CSSProperties;
  badge?: React.ReactNode;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  maxLife: number;
  life: number;
  color: string;
}

export const SmokeType: React.FC<SmokeTypeProps> = ({
  text,
  as: Component = 'h1',
  fontSize,
  fontWeight = 800,
  letterSpacing = '-0.035em',
  lineHeight = 1.08,
  color = '#ffffff',
  smokeColor = '#60a5fa',
  delay = 0.15,
  duration = 0.95,
  stagger = 0.07,
  rise = 0.8,
  turbulence = 1,
  replayOnHover = true,
  className = '',
  style = {},
  badge,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animKey, setAnimKey] = useState(0);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const isPlayingRef = useRef(false);

  // Trigger smoke particle generation
  const emitSmoke = useCallback(
    (x: number, y: number, count: number = 6) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.9 * turbulence;
        const speed = 0.8 + Math.random() * 1.5;
        particlesRef.current.push({
          x: x + (Math.random() - 0.5) * 16,
          y: y + (Math.random() - 0.5) * 12,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          radius: 8 + Math.random() * 16,
          alpha: 0.35 + Math.random() * 0.35,
          maxLife: 35 + Math.random() * 30,
          life: 0,
          color: smokeColor,
        });
      }
    },
    [smokeColor, turbulence],
  );

  // Canvas render loop for drifting smoke wisps
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let active = true;

    const resize = () => {
      const parent = containerRef.current;
      if (parent && canvas) {
        const rect = parent.getBoundingClientRect();
        canvas.width = rect.width + 120;
        canvas.height = rect.height + 80;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      if (!active) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p) continue;
        p.life++;
        p.x += p.vx + (Math.random() - 0.5) * 0.4 * turbulence;
        p.y += p.vy;
        p.radius += 0.35;
        p.alpha *= 0.96;

        if (p.life >= p.maxLife || p.alpha <= 0.01) {
          particles.splice(i, 1);
          continue;
        }

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, 'transparent');

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      active = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [turbulence]);

  // Trigger smoke particle bursts synchronized with letter reveals
  useEffect(() => {
    const letters = containerRef.current?.querySelectorAll<HTMLElement>('.smoke-letter');
    if (!letters) return;

    isPlayingRef.current = true;
    particlesRef.current = [];

    letters.forEach((el, index) => {
      const letterDelay = (delay + index * stagger) * 1000;
      setTimeout(() => {
        if (!containerRef.current || !canvasRef.current) return;
        const cRect = canvasRef.current.getBoundingClientRect();
        const lRect = el.getBoundingClientRect();
        const centerX = lRect.left - cRect.left + lRect.width / 2;
        const centerY = lRect.top - cRect.top + lRect.height / 2;
        emitSmoke(centerX, centerY, 5);
      }, letterDelay);
    });

    const totalTime = (delay + letters.length * stagger + duration) * 1000;
    const finishTimeout = setTimeout(() => {
      isPlayingRef.current = false;
    }, totalTime);

    return () => clearTimeout(finishTimeout);
  }, [animKey, delay, stagger, duration, emitSmoke]);

  const handleReplay = () => {
    setAnimKey((k) => k + 1);
  };

  // Split into words, then characters
  const words = text.split(' ');
  let charCounter = 0;

  return (
    <div
      ref={containerRef}
      className={`relative inline-block select-none ${className}`}
      onMouseEnter={replayOnHover ? handleReplay : undefined}
      style={{ ...style }}
    >
      {/* Smoke Canvas Backdrop */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute -left-12 -top-10 z-0 opacity-80"
      />

      {/* Main Headline */}
      <Component
        key={animKey}
        className="relative z-10 flex flex-wrap items-baseline gap-x-[0.28em]"
        style={{
          fontSize,
          fontWeight,
          letterSpacing,
          lineHeight,
          color,
        }}
      >
        {words.map((word, wIdx) => {
          return (
            <span key={wIdx} className="inline-flex whitespace-nowrap">
              {word.split('').map((char) => {
                const charIndex = charCounter++;
                const charDelay = delay + charIndex * stagger;

                return (
                  <span
                    key={charIndex}
                    className="smoke-letter inline-block transition-transform duration-200"
                    style={
                      {
                        '--smoke-delay': `${charDelay}s`,
                        '--smoke-duration': `${duration}s`,
                        '--smoke-rise': `${rise}em`,
                        '--smoke-color': smokeColor,
                        '--char-color': color,
                        animation: `smokeCondense ${duration}s cubic-bezier(0.22, 1, 0.36, 1) ${charDelay}s forwards`,
                        opacity: 0,
                        transform: `translateY(${rise}em) scale(1.15)`,
                        filter: 'blur(16px)',
                        color: smokeColor,
                      } as React.CSSProperties
                    }
                  >
                    {char}
                  </span>
                );
              })}
            </span>
          );
        })}

        {/* Optional trailing badge like ERP */}
        {badge && <span className="inline-flex items-center ml-2">{badge}</span>}
      </Component>
    </div>
  );
};
