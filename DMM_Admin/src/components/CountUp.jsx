import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { formatNumber } from '../lib/utils.js';

// Animates a number up from 0 on first render and smoothly to new values on
// refetch. Instant under reduced motion.
export default function CountUp({ value, decimals = 0, duration = 0.9 }) {
  const target = Number(value) || 0;
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (reduce) { current.current = target; setN(target); return undefined; }
    const c = animate(current.current, target, {
      duration, ease: 'easeOut',
      onUpdate: (v) => { current.current = v; setN(v); },
    });
    return () => c.stop();
  }, [target, reduce, duration]);
  return <>{decimals > 0 ? n.toFixed(decimals) : formatNumber(Math.round(n))}</>;
}
