import { useEffect, useRef, useState } from 'react'

export function useScrollReveal({
  rootMargin = '0px 0px -10% 0px',
  threshold = 0.12,
  once = true,
} = {}) {
  const ref = useRef(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reducedMotion || !('IntersectionObserver' in window)) {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          if (once) observer.unobserve(entry.target)
          return
        }

        if (!once) setIsVisible(false)
      },
      { rootMargin, threshold },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [once, rootMargin, threshold])

  return { ref, isVisible }
}
