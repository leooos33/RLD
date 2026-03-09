import { useEffect, useRef, useState } from 'react'

/**
 * useInView — fires once when the element enters the viewport.
 * Used by all landing-page sections for scroll-triggered reveal animations.
 *
 * @param {number} threshold  IntersectionObserver threshold (0–1)
 * @returns {[React.Ref, boolean]}
 */
export default function useInView(threshold = 0.08) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true) },
      { threshold },
    )
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])

  return [ref, inView]
}
