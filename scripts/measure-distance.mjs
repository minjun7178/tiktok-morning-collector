// Offline geometry calculation only. Live input is performed separately after confirmation.
import { readFile } from 'node:fs/promises';

export function calculateDrag(measurement) {
  const { pieceEdgeX, gapEdgeX, imageWidth, pieceBoxWidth, trackWidth,
    handleWidth, handleCenterX, handleCenterY, observedRatio, assumedRatio } = measurement;
  const pieceDelta = gapEdgeX - pieceEdgeX;
  const ratio = observedRatio ?? assumedRatio ?? ((imageWidth - pieceBoxWidth) / (trackWidth - handleWidth));
  if (![pieceDelta, ratio, handleCenterX, handleCenterY].every(Number.isFinite) || ratio <= 0)
    throw new Error('Invalid measured geometry');
  const dragDelta = pieceDelta / ratio;
  return { pieceDelta, ratio, dragDelta,
    from: [handleCenterX, handleCenterY],
    to: [Math.round(handleCenterX + dragDelta), Math.round(handleCenterY)],
    certainty: observedRatio == null ? 'candidate: intermediate UI movement ratio not measured' : 'calibrated' };
}

if (process.argv[2]) {
  const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
  console.log(JSON.stringify(calculateDrag(data), null, 2));
}
