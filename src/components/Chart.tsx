import React, { useRef, useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, LineChart, BarChart2, Maximize2, Minimize2, X } from 'lucide-react';
import { Asset, Tick, Contract, IndicatorConfig } from '../types';

interface ChartProps {
  theme?: 'dark' | 'light';
  asset: Asset;
  ticks: Tick[];
  activeContracts: Contract[];
  indicatorConfig: IndicatorConfig;
  chartType: 'line' | 'candles';
  onToggleChartType: (type: 'line' | 'candles') => void;
  onToggleIndicator: (type: 'sma' | 'ema' | 'rsi') => void;
  onUpdateContract?: (id: string, updates: Partial<Contract>) => void;
  onPriceClick?: (price: number) => void;
}

export default function Chart({
  theme = 'light',
  asset,
  ticks,
  activeContracts,
  indicatorConfig,
  chartType: initialChartType = 'line',
  onToggleChartType,
  onToggleIndicator,
  onUpdateContract,
  onPriceClick
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 700, height: 400 });
  const [zoomLevel, setZoomLevel] = useState(16); // fewer elements -> larger candles
  const [showIndicatorsPanel, setShowIndicatorsPanel] = useState(false);
  const [localChartType, setLocalChartType] = useState<'line' | 'candles'>(initialChartType);

  const isDark = theme === 'dark';

  // State for hover-tooltip states
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [inactivityCountdown, setInactivityCountdown] = useState<number | null>(null);
  const scaleMetricsRef = useRef({ adjustedMin: 0, adjustedPriceRange: 1, mainChartHeight: 300 });

  // Drag-to-set state
  const [draggingItem, setDraggingItem] = useState<{ contractId: string; lineType: 'sl' | 'tp' | 'entry' } | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const [hoverLine, setHoverLine] = useState<{ contractId: string; lineType: 'sl' | 'tp' | 'entry' } | null>(null);

  // 1. Calculate SMA Array
  const smaPeriod = indicatorConfig.sma.period;
  const smaArray = React.useMemo(() => {
    const sma: (number | null)[] = [];
    for (let i = 0; i < ticks.length; i++) {
      if (i < smaPeriod - 1) {
        sma.push(null);
      } else {
        let sum = 0;
        for (let j = 0; j < smaPeriod; j++) {
          sum += ticks[i - j].price;
        }
        sma.push(sum / smaPeriod);
      }
    }
    return sma;
  }, [ticks, smaPeriod]);

  // 2. Calculate EMA Array
  const emaPeriod = indicatorConfig.ema.period;
  const emaArray = React.useMemo(() => {
    const ema: (number | null)[] = [];
    if (ticks.length === 0) return ema;
    const k = 2 / (emaPeriod + 1);
    let prevEma = ticks[0].price;
    ema.push(prevEma);
    for (let i = 1; i < ticks.length; i++) {
      const curEma = ticks[i].price * k + prevEma * (1 - k);
      ema.push(curEma);
      prevEma = curEma;
    }
    return ema;
  }, [ticks, emaPeriod]);

  // 3. Calculate RSI Array
  const rsiPeriod = indicatorConfig.rsi.period;
  const rsiArray = React.useMemo(() => {
    const rsiValues: (number | null)[] = [];
    for (let i = 0; i < ticks.length; i++) {
      if (i < rsiPeriod) {
        rsiValues.push(50);
        continue;
      }

      let gains = 0;
      let losses = 0;

      for (let j = 0; j < rsiPeriod; j++) {
        const diff = ticks[i - j].price - ticks[i - j - 1].price;
        if (diff > 0) gains += diff;
        else losses -= diff;
      }

      const rs = gains / (losses || 0.0000001);
      const rsi = 100 - 100 / (1 + rs);
      rsiValues.push(rsi);
    }
    return rsiValues;
  }, [ticks, rsiPeriod]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || ticks.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x, y });

    const { adjustedMin, adjustedPriceRange, mainChartHeight } = scaleMetricsRef.current;
    const priceAtY = adjustedMin + ((mainChartHeight - y - 20) / (mainChartHeight - 40)) * adjustedPriceRange;

    // Use a helper inline to calculate Y for collision
    const getY = (price: number) => {
      if (adjustedPriceRange === 0) return mainChartHeight / 2;
      return mainChartHeight - ((price - adjustedMin) / adjustedPriceRange) * (mainChartHeight - 40) - 20;
    };

    if (draggingItem) {
      setDragY(priceAtY);
      return;
    }

    let hovered: { contractId: string; lineType: 'sl' | 'tp' | 'entry' } | null = null;
    if (!draggingItem) {
      for (const c of activeContracts) {
        if (c.stopLossPrice && Math.abs(y - getY(c.stopLossPrice)) < 8) {
          hovered = { contractId: c.id, lineType: 'sl' }; 
          break;
        }
        if (c.takeProfitPrice && Math.abs(y - getY(c.takeProfitPrice)) < 8) {
          hovered = { contractId: c.id, lineType: 'tp' }; 
          break;
        }
        const entryP = c.entryPrice || c.barrier;
        if (entryP && Math.abs(y - getY(entryP)) < 8) {
          hovered = { contractId: c.id, lineType: 'entry' };
          break;
        }
      }
    }
    setHoverLine(hovered);

    const activeWidth = dimensions.width - 75;
    const sliceCount = Math.min(ticks.length, zoomLevel);
    
    if (x >= 10 && x <= activeWidth + 10) {
      const pct = (x - 10) / activeWidth;
      const indexWithinVisible = Math.round(pct * (sliceCount - 1));
      const clamped = Math.max(0, Math.min(sliceCount - 1, indexWithinVisible));
      const globalIndex = ticks.length - sliceCount + clamped;
      setHoveredIndex(globalIndex);
    } else {
      setHoveredIndex(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (hoverLine) {
       setDraggingItem(hoverLine);
       setDragY(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (draggingItem && dragY !== null && onUpdateContract) {
      const contract = activeContracts.find(c => c.id === draggingItem.contractId);
      if (contract) {
        let type = draggingItem.lineType;
        if (type === 'entry') {
           // Decide if it's SL or TP based on direction
           const entry = contract.entryPrice || contract.barrier || 0;
           const isRise = contract.direction === 'rise' || contract.direction === 'higher' || contract.direction === 'touch';
           if (dragY > entry) {
             type = isRise ? 'tp' : 'sl';
           } else {
             type = isRise ? 'sl' : 'tp';
           }
        }
        
        if (type === 'sl') {
          onUpdateContract(contract.id, { stopLossPrice: dragY });
        } else if (type === 'tp') {
          onUpdateContract(contract.id, { takeProfitPrice: dragY });
        }
      }
    } else if (!draggingItem && mousePos && mousePos.x > dimensions.width - 75) {
      if (onPriceClick) {
        const { adjustedMin, adjustedPriceRange, mainChartHeight } = scaleMetricsRef.current;
        if (mousePos.y <= mainChartHeight && mainChartHeight > 40) {
          const fraction = (mainChartHeight - mousePos.y - 20) / (mainChartHeight - 40);
          const clickedPrice = adjustedMin + adjustedPriceRange * fraction;
          onPriceClick(clickedPrice);
        }
      }
    }
    setDraggingItem(null);
    setDragY(null);
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setMousePos(null);
    setDraggingItem(null);
    setDragY(null);
  };

  // ResizeObserver to track container bounds dynamically
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.max(width, 300), height: Math.max(height, 300) });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Listen for Escape key to exit fullscreen mode
  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullScreen]);

  // Full-screen inactivity auto-close timer (60 seconds)
  useEffect(() => {
    if (!isFullScreen) {
      setInactivityCountdown(null);
      return;
    }

    const INACTIVITY_LIMIT_MS = 60 * 1000;
    const WARNING_THRESHOLD_MS = 15 * 1000;
    
    let activityTimeout: NodeJS.Timeout;
    let countdownInterval: NodeJS.Timeout;
    let secondsLeft = 60;

    const resetInactivityTimer = () => {
      clearTimeout(activityTimeout);
      clearInterval(countdownInterval);
      setInactivityCountdown(null);
      secondsLeft = 60;

      activityTimeout = setTimeout(() => {
        setIsFullScreen(false);
      }, INACTIVITY_LIMIT_MS);

      let elapsed = 0;
      countdownInterval = setInterval(() => {
        elapsed += 1000;
        if (elapsed >= (INACTIVITY_LIMIT_MS - WARNING_THRESHOLD_MS)) {
          secondsLeft = Math.max(0, Math.ceil((INACTIVITY_LIMIT_MS - elapsed) / 1000));
          setInactivityCountdown(secondsLeft);
        }
      }, 1000);
    };

    resetInactivityTimer();

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach(event => {
      window.addEventListener(event, resetInactivityTimer);
    });

    return () => {
      clearTimeout(activityTimeout);
      clearInterval(countdownInterval);
      events.forEach(event => {
        window.removeEventListener(event, resetInactivityTimer);
      });
    };
  }, [isFullScreen]);

  // Native listener for smooth mouse scroll wheel zooming over the chart container
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const handleWheelZoom = (e: WheelEvent) => {
      e.preventDefault();
      const zoomStep = 4;
      if (e.deltaY < 0) {
        // Scroll Up -> Zoom In (Fewer ticks shown, closer view)
        setZoomLevel((prev) => Math.max(prev - zoomStep, 8));
      } else {
        // Scroll Down -> Zoom Out (More ticks shown, wider context)
        setZoomLevel((prev) => Math.min(prev + zoomStep, 120));
      }
    };

    parent.addEventListener('wheel', handleWheelZoom, { passive: false });
    return () => {
      parent.removeEventListener('wheel', handleWheelZoom);
    };
  }, []);

  // Compute Candles from Ticks for the candlestick view
  const [candleInterval, setCandleInterval] = useState<number>(2000); // 2 seconds per candle default
  const getCandles = (useHeikinAshi = false) => {
    if (ticks.length === 0) return [];
    const candles: { time: number; open: number; high: number; low: number; close: number }[] = [];
    let currentCandle: any = null;

    ticks.forEach((tick) => {
      const bucketTime = Math.floor(tick.time / candleInterval) * candleInterval;
      if (!currentCandle || currentCandle.time !== bucketTime) {
        if (currentCandle) {
          candles.push(currentCandle);
        }
        currentCandle = {
          time: bucketTime,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, tick.price);
        currentCandle.low = Math.min(currentCandle.low, tick.price);
        currentCandle.close = tick.price;
      }
    });

    if (currentCandle) {
      candles.push(currentCandle);
    }

    if (useHeikinAshi && candles.length > 0) {
      const haCandles: any[] = [];
      let lastHA = candles[0];

      candles.forEach((c, i) => {
        const close = (c.open + c.high + c.low + c.close) / 4;
        const open = i === 0 ? (c.open + c.close) / 2 : (lastHA.open + lastHA.close) / 2;
        const high = Math.max(c.high, open, close);
        const low = Math.min(c.low, open, close);
        const ha = { time: c.time, open, high, low, close };
        haCandles.push(ha);
        lastHA = ha;
      });
      return haCandles;
    }

    return candles;
  };

  // Memoize candles to prevent recalculation on every mouse move or loop tick
  const candles = React.useMemo(() => {
    return getCandles();
  }, [ticks, candleInterval]);

  // Track parameters for high performance requestAnimationFrame loop
  const drawParamsRef = useRef({
    dimensions,
    ticks,
    activeContracts,
    indicatorConfig,
    localChartType,
    zoomLevel,
    asset,
    isDark,
    hoveredIndex,
    mousePos,
    smaArray,
    emaArray,
    rsiArray,
    candles,
  });

  // Keep parameters updated on every render
  useEffect(() => {
    drawParamsRef.current = {
      dimensions,
      ticks,
      activeContracts,
      indicatorConfig,
      localChartType,
      zoomLevel,
      asset,
      isDark,
      hoveredIndex,
      mousePos,
      smaArray,
      emaArray,
      rsiArray,
      candles,
    };
  }, [
    dimensions,
    ticks,
    activeContracts,
    indicatorConfig,
    localChartType,
    zoomLevel,
    asset,
    isDark,
    hoveredIndex,
    mousePos,
    smaArray,
    emaArray,
    rsiArray,
    candles
  ]);

  // Canvas Drawing Loop via requestAnimationFrame for butter-smooth animation
  useEffect(() => {
    let animationFrameId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const params = drawParamsRef.current;
      const {
        dimensions,
        ticks,
        activeContracts,
        indicatorConfig,
        localChartType,
        zoomLevel,
        asset,
        isDark,
        hoveredIndex,
        mousePos,
        smaArray,
        emaArray,
        rsiArray,
        candles: visibleCandlesList,
      } = params;

      if (ticks.length === 0) {
        // Clear screen and redraw empty state
        ctx.clearRect(0, 0, dimensions.width, dimensions.height);
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Device Pixel Ratio scaling for ultra-crisp presentation
      const dpr = window.devicePixelRatio || 1;
      canvas.width = dimensions.width * dpr;
      canvas.height = dimensions.height * dpr;
      ctx.scale(dpr, dpr);

      const width = dimensions.width;
      const height = dimensions.height;

      // RSI sub-panel layout bounds (takes 20% of canvas if enabled)
      const showRSI = indicatorConfig.rsi.enabled;
      const mainChartHeight = showRSI ? height * 0.77 : height;
      const rsiHeight = showRSI ? height * 0.18 : 0;
      const rsiTop = mainChartHeight + 5;
      const rsiBottom = height - 5;

      ctx.clearRect(0, 0, width, height);

      // Filter visible window data depending on zoom
      const sliceCount = Math.min(ticks.length, zoomLevel);
      const visibleTicks = ticks.slice(-sliceCount);
      if (visibleTicks.length < 2) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Find Price Bounds for rendering fitting
      let minPrice = Infinity;
      let maxPrice = -Infinity;

      if (localChartType === 'line') {
        visibleTicks.forEach((t) => {
          minPrice = Math.min(minPrice, t.price);
          maxPrice = Math.max(maxPrice, t.price);
        });
      } else {
        const visibleCandlesCount = Math.min(visibleCandlesList.length, Math.floor(zoomLevel / 1.5));
        const visibleCandles = visibleCandlesList.slice(-visibleCandlesCount);
        if (visibleCandles.length > 0) {
          visibleCandles.forEach((c) => {
            let highVal = c.high;
            let lowVal = c.low;
            if (candleInterval === 2000) {
              const mid = (c.open + c.close) / 2;
              const scale = 3.5;
              highVal = mid + (c.high - mid) * scale;
              lowVal = mid + (c.low - mid) * scale;
            }
            minPrice = Math.min(minPrice, lowVal);
            maxPrice = Math.max(maxPrice, highVal);
          });
        } else {
          visibleTicks.forEach((t) => {
            minPrice = Math.min(minPrice, t.price);
            maxPrice = Math.max(maxPrice, t.price);
          });
        }
      }

      // Merge barrier prices from active contracts to keep them in viewport
      activeContracts.forEach((contract) => {
        if (contract.barrier) {
          minPrice = Math.min(minPrice, contract.barrier);
          maxPrice = Math.max(maxPrice, contract.barrier);
        }
      });

      const priceRange = maxPrice - minPrice || 1.0;
      const padding = priceRange * 0.2; // 20% cushioning
      const adjustedMin = minPrice - padding;
      const adjustedMax = maxPrice + padding;
      const adjustedPriceRange = adjustedMax - adjustedMin;

      // Store current metrics in ref for floating cursor label mapping
      scaleMetricsRef.current = { adjustedMin, adjustedPriceRange, mainChartHeight };

      // Pricing coordinate mapping helptool
      const getX = (index: number, total: number) => {
        const activeWidth = width - 75;
        return (index / (total - 1)) * activeWidth + 10;
      };

      const getY = (price: number) => {
        return mainChartHeight - ((price - adjustedMin) / adjustedPriceRange) * (mainChartHeight - 40) - 20;
      };

      // Draw Minimal Grid Coordinates
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
      const textColor = isDark ? '#52525b' : '#94a3b8';

      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]); // Dotted grid
      ctx.font = '10px sans-serif';
      ctx.fillStyle = textColor;

      // Horizontal pricing lines
      const gridLinesCount = 8;
      for (let i = 0; i < gridLinesCount; i++) {
        const priceVal = adjustedMin + (i * adjustedPriceRange) / (gridLinesCount - 1);
        const gridY = getY(priceVal);

        ctx.beginPath();
        ctx.moveTo(0, gridY);
        ctx.lineTo(width - 75, gridY);
        ctx.stroke();

        ctx.fillText(priceVal?.toFixed(asset.decimals) ?? '0.00', width - 70, gridY + 3);
      }

      // Vertical time lines
      const timeLinesCount = 6;
      for (let i = 0; i < timeLinesCount; i++) {
        const gridX = getX(i * Math.floor((visibleTicks.length - 1) / (timeLinesCount - 1)), visibleTicks.length);
        
        ctx.beginPath();
        ctx.moveTo(gridX, 0);
        ctx.lineTo(gridX, mainChartHeight);
        ctx.stroke();

        const tickIdx = Math.floor(i * (visibleTicks.length - 1) / (timeLinesCount - 1));
        if (visibleTicks[tickIdx]) {
           const timeLabel = new Date(visibleTicks[tickIdx].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
           ctx.fillText(timeLabel, gridX + 5, mainChartHeight - 5);
        }
      }

      ctx.setLineDash([]); // Reset line dash

      // --- DRAW PRICE TRENDS ---
      if (localChartType === 'line') {
        const grad = ctx.createLinearGradient(0, getY(adjustedMax), 0, mainChartHeight);
        grad.addColorStop(0, isDark ? 'rgba(168, 85, 247, 0.15)' : 'rgba(168, 85, 247, 0.1)');
        grad.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

        ctx.beginPath();
        ctx.moveTo(getX(0, visibleTicks.length), mainChartHeight);
        for (let i = 0; i < visibleTicks.length; i++) {
          ctx.lineTo(getX(i, visibleTicks.length), getY(visibleTicks[i].price));
        }
        ctx.lineTo(getX(visibleTicks.length - 1, visibleTicks.length), mainChartHeight);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = '#a855f7'; 
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 0; i < visibleTicks.length; i++) {
          const x = getX(i, visibleTicks.length);
          const y = getY(visibleTicks[i].price);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        const visibleCandlesCount = Math.min(visibleCandlesList.length, Math.floor(zoomLevel / 1.5));
        const visibleCandles = visibleCandlesList.slice(-visibleCandlesCount);

        if (visibleCandles.length > 0) {
          const activeWidth = width - 75;
          let barSeparation = activeWidth / Math.max(visibleCandles.length - 1, 1);
          
          const isHighTF = candleInterval >= 60000;
          if (isHighTF) {
            // Cap horizontal separation at 20px so candles are drawn close to each other
            barSeparation = Math.min(barSeparation, 20);
          }

          const barWidth = Math.max(Math.min(barSeparation * 0.45, 12), 4); // Perfectly proportioned width

          visibleCandles.forEach((candle, idx) => {
            let cX;
            if (isHighTF) {
              // Right-aligned spacing for a professional close-packed fit when few candles exist
              const offsetFromRight = (visibleCandles.length - 1 - idx) * barSeparation;
              cX = (activeWidth + 10) - offsetFromRight;
            } else {
              // Standard wide left-to-right filling layout for TF 2s
              cX = (idx / Math.max(visibleCandles.length - 1, 1)) * activeWidth + 10;
            }

            // Apply scale factor if TF is 2s (candleInterval === 2000) to make it larger in height (vertical size)
            let openVal = candle.open;
            let closeVal = candle.close;
            let highVal = candle.high;
            let lowVal = candle.low;

            if (candleInterval === 2000) {
              const mid = (candle.open + candle.close) / 2;
              const scale = 3.5; // Stretch vertically by 3.5x to highlight price movements
              openVal = mid + (candle.open - mid) * scale;
              closeVal = mid + (candle.close - mid) * scale;
              highVal = mid + (candle.high - mid) * scale;
              lowVal = mid + (candle.low - mid) * scale;
            }

            const openY = getY(openVal);
            const closeY = getY(closeVal);
            const highY = getY(highVal);
            const lowY = getY(lowVal);

            const isBull = candle.close >= candle.open;
            const color = isBull ? '#089981' : '#f23645';
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cX, highY);
            ctx.lineTo(cX, lowY);
            ctx.stroke();

            const bodyY = Math.min(openY, closeY);
            const bodyH = Math.max(Math.abs(openY - closeY), 1.5);
            
            ctx.fillRect(cX - barWidth / 2, bodyY, barWidth, bodyH);
          });
        }
      }

      // --- DRAW SMA ---
      if (indicatorConfig.sma.enabled) {
        ctx.beginPath();
        ctx.strokeStyle = '#38bdf8'; // Sky blue
        ctx.lineWidth = 1.5;
        let first = true;
        for (let i = 0; i < visibleTicks.length; i++) {
          const globalIndex = ticks.length - visibleTicks.length + i;
          const smaVal = smaArray[globalIndex];
          if (smaVal === null || smaVal === undefined) continue;
          const x = getX(i, visibleTicks.length);
          const y = getY(smaVal);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // --- DRAW EMA ---
      if (indicatorConfig.ema.enabled) {
        ctx.beginPath();
        ctx.strokeStyle = '#f97316'; // Vivid orange
        ctx.lineWidth = 1.5;
        let first = true;
        for (let i = 0; i < visibleTicks.length; i++) {
          const globalIndex = ticks.length - visibleTicks.length + i;
          const emaVal = emaArray[globalIndex];
          if (emaVal === null || emaVal === undefined) continue;
          const x = getX(i, visibleTicks.length);
          const y = getY(emaVal);
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // --- CURRENT PRICE PULSE ---
      const latestTick = ticks[ticks.length - 1];
      const latestY = getY(latestTick.price);
      const latestX = getX(visibleTicks.length - 1, visibleTicks.length);

      const pulse = (Date.now() % 2000) / 2000;
      ctx.beginPath();
      ctx.arc(latestX, latestY, 4 + pulse * 20, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(168, 85, 247, ${1 - pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.arc(latestX, latestY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Price Bubble
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.roundRect(width - 74, latestY - 10, 71, 20, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(latestTick.price?.toFixed(asset.decimals) ?? '0.00', width - 68, latestY + 4);

      // --- ACTIVE POSITION OVERLAYS ---
      activeContracts.forEach((contract) => {
        // Draw Entry Line / Barrier
        const entryP = contract.entryPrice || contract.barrier;
        if (entryP) {
          const bary = getY(entryP);
          ctx.strokeStyle = contract.currentProfit >= 0 ? '#14b8a6' : '#f59e0b';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, bary);
          ctx.lineTo(width-75, bary);
          ctx.stroke();

          // Render bubble
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath();
          ctx.roundRect(width - 74, bary - 10, 71, 20, 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('ENTRY', width - 68, bary + 3);
          
          ctx.setLineDash([]);
        }

        // Output SL Price
        if (contract.stopLossPrice) {
          const slY = getY(contract.stopLossPrice);
          ctx.strokeStyle = '#ef4444'; // Red for SL
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, slY);
          ctx.lineTo(width-75, slY);
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.roundRect(width - 74, slY - 10, 71, 20, 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('SL', width - 68, slY + 3);
          
          ctx.setLineDash([]);
        }

        // Output TP Price
        if (contract.takeProfitPrice) {
          const tpY = getY(contract.takeProfitPrice);
          ctx.strokeStyle = '#22c55e'; // Green for TP
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, tpY);
          ctx.lineTo(width-75, tpY);
          ctx.stroke();

          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.roundRect(width - 74, tpY - 10, 71, 20, 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px monospace';
          ctx.fillText('TP', width - 68, tpY + 3);
          
          ctx.setLineDash([]);
        }

        if (contract.type === 'digit-over-under') {
           ctx.fillStyle = 'rgba(168, 85, 247, 0.1)';
           ctx.font = 'bold 40px sans-serif';
           ctx.textAlign = 'center';
           ctx.fillText(`${contract.direction === 'over' ? '>' : '<'} ${contract.targetDigit}`, width / 2, mainChartHeight / 2);
           ctx.textAlign = 'left';
        }
      });
      
      // Draw dragged line actively
      if (draggingItem && dragY !== null) {
        const dY = getY(dragY);
        ctx.strokeStyle = '#eab308'; // Yellow for dragging
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, dY);
        ctx.lineTo(width-75, dY);
        ctx.stroke();
        
        ctx.fillStyle = '#eab308';
        ctx.beginPath();
        ctx.roundRect(width - 74, dY - 10, 71, 20, 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(dragY.toFixed(asset.decimals), width - 68, dY + 3);
          
        ctx.setLineDash([]);
      }

      // --- DRAW DYNAMIC HOVER CROSSHAIRS & DOTS ---
      if (hoveredIndex !== null && mousePos !== null) {
        const visibleIndex = hoveredIndex - (ticks.length - visibleTicks.length);
        if (visibleIndex >= 0 && visibleIndex < visibleTicks.length) {
          const x = getX(visibleIndex, visibleTicks.length);
          const y = getY(ticks[hoveredIndex].price);
          
          // Hover trackers removed as requested for a cleaner chart
        }
      }

      // --- RSI PLOT SUB-PANEL ---
      if (showRSI) {
        const rsiBgColor = isDark ? '#141416' : '#f9fafb';
        const rsiLineColor = isDark ? '#27272a' : '#e5e7eb';

        ctx.fillStyle = rsiBgColor;
        ctx.fillRect(0, rsiTop, width, rsiHeight);

        ctx.strokeStyle = rsiLineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, rsiTop);
        ctx.lineTo(width, rsiTop);
        ctx.stroke();

        const rsiValToY = (val: number) => {
          return rsiBottom - (val / 100) * (rsiHeight - 12) - 6;
        };

        ctx.strokeStyle = 'rgba(244, 63, 94, 0.2)';
        ctx.beginPath();
        ctx.moveTo(0, rsiValToY(70));
        ctx.lineTo(width - 75, rsiValToY(70));
        ctx.moveTo(0, rsiValToY(30));
        ctx.lineTo(width - 75, rsiValToY(30));
        ctx.stroke();

        ctx.fillStyle = '#f43f5e';
        ctx.font = '8px monospace';
        ctx.fillText('70 OB', width - 70, rsiValToY(70) + 3);
        ctx.fillText('30 OS', width - 70, rsiValToY(30) + 3);

        ctx.beginPath();
        ctx.strokeStyle = '#7c3aed'; // Clean purple
        ctx.lineWidth = 1.3;
        let first = true;

        for (let i = 0; i < visibleTicks.length; i++) {
          const globalIdx = ticks.length - visibleTicks.length + i;
          const rsiVal = rsiArray[globalIdx] ?? 50;
          const rsiX = getX(i, visibleTicks.length);
          const rsiY = rsiValToY(rsiVal);

          if (first) {
            ctx.moveTo(rsiX, rsiY);
            first = false;
          } else {
            ctx.lineTo(rsiX, rsiY);
          }
        }
        ctx.stroke();

        ctx.fillStyle = '#7c3aed';
        ctx.font = 'bold 8px monospace';
        ctx.fillText(`RSI (${rsiPeriod})`, 10, rsiTop + 12);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  // Handle Zoom Operations safely
  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.max(prev - 4, 8));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.min(prev + 4, 120));
  };

  const handleToggleLocalChartType = (type: 'line' | 'candles') => {
    setLocalChartType(type);
    onToggleChartType(type);
  };

  return (
    <div className={`relative flex flex-col rounded-xl border p-4 shadow-sm w-full h-[360px] sm:h-[420px] transition-colors ${
      isDark ? 'border-slate-800 bg-slate-900/50 backdrop-blur-md text-white' : 'border-gray-100 bg-white text-black'
    }`}>
      {/* Chart controls toolbar */}
      <div className={`flex flex-wrap items-center justify-between border-b pb-3 mb-3 gap-2 ${
        isDark ? 'border-slate-800 text-slate-200' : 'border-gray-50 text-black'
      }`}>
        <div className="flex items-center space-x-3">
          {/* Active Asset Info Badge */}
          <div className={`flex items-center space-x-1.5 rounded px-2 py-1 ${
            isDark ? 'bg-slate-950' : 'bg-gray-50'
          }`}>
            <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-sans font-bold text-xs">{asset.name}</span>
            <span className={`font-mono text-[9px] px-1 rounded uppercase font-bold ${
              isDark ? 'bg-slate-900 text-slate-400' : 'bg-gray-150 text-gray-500'
            }`}>
              {asset.symbol}
            </span>
          </div>

          {/* Current pricing quick stats */}
          {ticks.length > 0 && (
            <div className="font-mono text-xs font-bold">
              USD <span className={asset.change >= 0 ? "text-green-500" : "text-red-500"}>
                {ticks[ticks.length - 1]?.price?.toFixed(asset.decimals) ?? '0.00'}
              </span>
            </div>
          )}
        </div>

        {/* Action controls */}
        <div className="flex items-center space-x-2">
          {/* Chart Type Toggle */}
          <div className={`flex items-center space-x-0.5 rounded-lg p-0.5 border ${
            isDark ? 'bg-slate-950 border-slate-800' : 'bg-gray-50 border-gray-100'
          }`}>
            <button
              onClick={() => handleToggleLocalChartType('line')}
              className={`rounded p-1 cursor-pointer transition-all ${
                localChartType === 'line'
                  ? isDark ? 'bg-yellow-500 text-slate-950 font-bold' : 'bg-black text-white'
                  : isDark ? 'text-slate-400 hover:text-white hover:bg-slate-900/30' : 'text-gray-400 hover:text-black'
              }`}
              title="Line Chart"
            >
              <LineChart className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handleToggleLocalChartType('candles')}
              className={`rounded p-1 cursor-pointer transition-all ${
                localChartType === 'candles'
                  ? isDark ? 'bg-yellow-500 text-slate-950 font-bold' : 'bg-black text-white'
                  : isDark ? 'text-slate-400 hover:text-white hover:bg-slate-900/30' : 'text-gray-400 hover:text-black'
              }`}
              title="Candlestick Chart"
            >
              <BarChart2 className="h-3.5 w-3.5 rotate-90" />
            </button>
          </div>

          {/* Timeframe Select Dropdown */}
          <div className={`flex items-center space-x-1 rounded-lg border px-1.5 py-0.5 ${
            isDark ? 'bg-slate-950 border-slate-800' : 'bg-gray-50 border-gray-100'
          }`}>
            <span className="text-[9px] text-slate-400 font-bold uppercase select-none">TF:</span>
            <select
              value={candleInterval}
              onChange={(e) => setCandleInterval(Number(e.target.value))}
              className={`bg-transparent text-[11px] font-black font-mono outline-none transition-all cursor-pointer ${
                isDark 
                  ? 'text-yellow-400' 
                  : 'text-gray-800'
              }`}
            >
              <option className={isDark ? "bg-slate-950 text-white" : "bg-white text-black"} value={2000}>2s</option>
              <option className={isDark ? "bg-slate-950 text-white" : "bg-white text-black"} value={60000}>1m</option>
              <option className={isDark ? "bg-slate-950 text-white" : "bg-white text-black"} value={300000}>5m</option>
              <option className={isDark ? "bg-slate-950 text-white" : "bg-white text-black"} value={900000}>15m</option>
            </select>
          </div>

          {/* Indicators popup drawer toggle */}
          <div className="relative">
            <button
              onClick={() => setShowIndicatorsPanel(!showIndicatorsPanel)}
              className={`flex items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-bold cursor-pointer transition-all border ${
                showIndicatorsPanel || Object.values(indicatorConfig).some(i => i.enabled)
                  ? isDark ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-purple-500/10 text-purple-600 border-purple-200'
                  : isDark ? 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white' : 'bg-white text-gray-500 border-gray-200 hover:text-black'
              }`}
            >
              <span>Indicators</span>
              <span className={`text-[10px] rounded px-1 font-mono font-bold ${isDark ? 'bg-slate-900 text-slate-300' : 'bg-gray-100'}`}>
                {Object.values(indicatorConfig).filter(i => i.enabled).length}
              </span>
            </button>

            {/* Float Menu for Indicators */}
            {showIndicatorsPanel && (
              <div className={`absolute right-0 mt-1.5 w-48 rounded-md border p-2.5 shadow-xl z-35 ${
                isDark ? 'border-slate-800 bg-slate-950 text-white' : 'border-gray-250 bg-white text-black'
              }`}>
                <div className="text-[10px] font-bold text-gray-400 uppercase pb-1.5 mb-1.5 border-b select-none">
                  Trading Overlays
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => onToggleIndicator('sma')}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs text-left cursor-pointer ${
                      isDark ? 'hover:bg-slate-900 text-slate-300' : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                      <span>SMA ({indicatorConfig.sma.period})</span>
                    </span>
                    <span className="text-[10px] font-bold">
                      {indicatorConfig.sma.enabled ? <span className="text-sky-505">ON</span> : <span className="text-gray-400">OFF</span>}
                    </span>
                  </button>

                  <button
                    onClick={() => onToggleIndicator('ema')}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs text-left cursor-pointer ${
                      isDark ? 'hover:bg-slate-900 text-slate-300' : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                      <span>EMA ({indicatorConfig.ema.period})</span>
                    </span>
                    <span className="text-[10px] font-bold">
                      {indicatorConfig.ema.enabled ? <span className="text-orange-505">ON</span> : <span className="text-gray-400">OFF</span>}
                    </span>
                  </button>

                  <button
                    onClick={() => onToggleIndicator('rsi')}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-xs text-left cursor-pointer ${
                      isDark ? 'hover:bg-slate-900 text-slate-300' : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                       <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                      <span>RSI ({indicatorConfig.rsi.period})</span>
                    </span>
                    <span className="text-[10px] font-bold">
                      {indicatorConfig.rsi.enabled ? <span className="text-purple-505">ON</span> : <span className="text-gray-400">OFF</span>}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Zoom Buttons */}
          <div className={`flex space-x-0.5 rounded-lg p-0.5 border ${
            isDark ? 'bg-slate-950 border-slate-800' : 'bg-gray-50 border-gray-100'
          }`}>
            <button
              onClick={handleZoomIn}
              className={`rounded p-1 transition-all cursor-pointer ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-900/40' : 'text-gray-400 hover:text-black'}`}
              title="Zoom In [Scroll Wheel Up on Chart]"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              className={`rounded p-1 transition-all cursor-pointer ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-900/40' : 'text-gray-400 hover:text-black'}`}
              title="Zoom Out [Scroll Wheel Down on Chart]"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Frame Container */}
      <div 
        id="chart-parent" 
        ref={containerRef} 
        className={`${
          isFullScreen 
            ? 'fixed inset-0 z-50 h-screen w-screen p-6 flex flex-col' 
            : 'relative flex-1 w-full rounded-md overflow-hidden'
        } ${
          isDark ? 'bg-slate-950 border border-slate-800/40' : 'bg-gray-50/30 border border-gray-100'
        }`}
      >
        {/* Full-Screen Controls Row */}
        <div className="absolute top-4 right-4 z-50 flex items-center space-x-2">
          {isFullScreen && inactivityCountdown !== null && (
            <div className="animate-pulse bg-red-600/90 border border-red-500/30 text-white rounded-lg px-3 py-1.5 flex items-center space-x-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider shadow-lg">
              <span className="h-2 w-2 rounded-full bg-white animate-ping" />
              <span>Inactivity exit in {inactivityCountdown}s</span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new Event('mousemove'));
                }}
                className="bg-white/20 hover:bg-white/40 text-white px-2 py-0.5 rounded text-[9px] cursor-pointer transition-colors font-bold uppercase"
              >
                Keep Open
              </button>
            </div>
          )}

          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className={`rounded-lg p-2 sm:px-3 sm:py-2 transition-all cursor-pointer shadow-lg border flex items-center space-x-2 ${
              isFullScreen
                ? 'bg-red-600 hover:bg-red-700 text-white border-red-500 font-semibold'
                : isDark 
                  ? 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800' 
                  : 'bg-white border-gray-200 text-slate-500 hover:text-black hover:bg-gray-50'
            }`}
            title={isFullScreen ? "Close Full-Screen View [ESC]" : "Enter Full-Screen"}
          >
            {isFullScreen ? (
              <>
                <X className="h-4 w-4 stroke-[2.5]" />
                <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">Close Chart</span>
                <kbd className="text-[9px] px-1.5 bg-red-800/80 text-white/90 rounded border border-red-400/40 font-mono hidden sm:inline">ESC</kbd>
              </>
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>

        <canvas
          id="drawing-surface"
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          style={{ width: '100%', height: '100%', display: 'block', cursor: draggingItem || hoverLine ? 'ns-resize' : 'crosshair' }}
        />

        {/* Empty State Guard */}
        {ticks.length === 0 && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center space-y-2 ${
            isDark ? 'bg-zinc-950/80' : 'bg-white/80'
          }`}>
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
            <span className="font-mono text-xs text-gray-400">Awaiting asset ticks...</span>
          </div>
        )}
      </div>
    </div>
  );
}
