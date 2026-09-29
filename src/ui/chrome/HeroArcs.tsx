import type { CSSProperties } from 'react';
import { ARCS_VIEW, FLIGHTS, flightGeometry, flightTiming, glyphPoints } from './arcs';

const { width, height, baseline } = ARCS_VIEW;

const delay = (ms: number): CSSProperties => ({ '--delay': `${ms}ms` }) as CSSProperties;

/**
 * The product in one picture: a routine of flights, in the grammar of the timeline. Rising blue, falling orange, the
 * center of mass in gold at the top; one flight drawn in full with its takeoff and landing. It draws itself in once.
 */
export function HeroArcs() {
  const hero = FLIGHTS.find((f) => f.hero);
  return (
    <svg
      className="arcs"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Flight arcs of a trampoline routine"
    >
      <line className="arcs__bed" x1="0" y1={baseline} x2={width} y2={baseline} />
      {FLIGHTS.map((flight, i) => {
        const g = flightGeometry(flight);
        const t = flightTiming(i);
        return (
          <g key={flight.takeoff} style={{ opacity: flight.strength }}>
            <path className="arcs__path arcs__path--lift" d={g.ascent} pathLength={1} style={delay(t.ascent)} />
            <path className="arcs__path arcs__path--drop" d={g.descent} pathLength={1} style={delay(t.descent)} />
            <circle
              className="arcs__apex"
              cx={g.apex.x}
              cy={g.apex.y}
              r={flight.hero ? 8 : 5.5}
              style={delay(t.apex)}
            />
          </g>
        );
      })}
      {hero && (
        <g className="arcs__marks" style={delay(flightTiming(FLIGHTS.indexOf(hero)).apex + 200)}>
          <polygon points={glyphPoints(hero.takeoff, baseline, 'up')} />
          <polygon points={glyphPoints(hero.landing, baseline, 'down')} />
        </g>
      )}
    </svg>
  );
}
