'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { thumbHashToDataURL } from '@/lib/thumbhash';

interface ThumbImageProps {
  src: string;
  alt: string;
  thumbhash?: string;
  dominantColor?: string;
  className?: string;
}

export const ThumbImage: React.FC<ThumbImageProps> = React.memo(
  ({ src, alt, thumbhash, dominantColor = '#131317', className = '' }) => {
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
        setLoaded(true);
      } else {
        setLoaded(false);
      }
    }, [src]);

    const placeholder = useMemo(() => {
      if (!thumbhash) return '';
      return thumbHashToDataURL(thumbhash);
    }, [thumbhash]);

    return (
      <div
        className="relative w-full h-full overflow-hidden"
        style={{
          backgroundColor: dominantColor || '#131317',
          backgroundImage: !loaded && placeholder ? `url(${placeholder})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover transition-opacity duration-150 ease-out ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${className}`}
        />
      </div>
    );
  }
);

ThumbImage.displayName = 'ThumbImage';
