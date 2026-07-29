import React, { useState, useEffect, useRef } from 'react'

const ERROR_IMG_SRC =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODgiIGhlaWdodD0iODgiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgc3Ryb2tlPSIjMDAwIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBvcGFjaXR5PSIuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIzLjciPjxyZWN0IHg9IjE2IiB5PSIxNiIgd2lkdGg9IjU2IiBoZWlnaHQ9IjU2IiByeD0iNiIvPjxwYXRoIGQ9Im0xNiA1OCAxNi0xOCAzMiAzMiIvPjxjaXJjbGUgY3g9IjUzIiBjeT0iMzUiIHI9IjciLz48L3N2Zz4KCg=='

interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  lazy?: boolean; // Enable lazy loading (default: true)
  threshold?: number; // Intersection observer threshold (default: 0.1)
}

export function ImageWithFallback(props: ImageWithFallbackProps) {
  const { src, alt, style, className, lazy = true, threshold = 0.1, loading, ...rest } = props;
  const [didError, setDidError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(!lazy); // Load immediately if lazy is false
  const imgRef = useRef<HTMLImageElement>(null);

  const handleError = () => {
    setDidError(true);
  };

  const handleLoad = () => {
    setIsLoaded(true);
  };

  // Lazy loading with Intersection Observer
  useEffect(() => {
    if (!lazy || shouldLoad) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before entering viewport
        threshold,
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [lazy, shouldLoad, threshold]);

  // Show error state
  if (didError) {
    return (
      <div
        className={`inline-block bg-gray-100 text-center align-middle ${className ?? ''}`}
        style={style}
      >
        <div className="flex items-center justify-center w-full h-full">
          <img src={ERROR_IMG_SRC} alt="Error loading image" {...rest} data-original-url={src} />
        </div>
      </div>
    );
  }

  // Show loading skeleton while lazy loading
  if (lazy && !shouldLoad) {
    return (
      <div
        ref={imgRef as any}
        className={`inline-block skeleton-loader ${className ?? ''}`}
        style={style}
        aria-label="Loading image..."
      />
    );
  }

  return (
    <img
      ref={imgRef}
      src={shouldLoad ? src : undefined}
      alt={alt}
      className={`${className ?? ''} ${!isLoaded && shouldLoad ? 'skeleton-loader' : ''}`}
      style={style}
      loading={loading || (lazy ? 'lazy' : 'eager')}
      onError={handleError}
      onLoad={handleLoad}
      {...rest}
    />
  );
}
