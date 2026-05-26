import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizePath(value, fallback) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeModes(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : fallback;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error('Payload too large');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function tryParseJsonText(text) {
  const source = String(text || '').trim();
  if (!source) return undefined;
  const candidates = [source];
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const dataPrefix = source.match(/\bdata\s*:\s*([\s\S]*)$/i);
  if (dataPrefix?.[1]) candidates.push(dataPrefix[1].trim());
  const firstObject = source.indexOf('{');
  const lastObject = source.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(source.slice(firstObject, lastObject + 1));
  const firstArray = source.indexOf('[');
  const lastArray = source.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) candidates.push(source.slice(firstArray, lastArray + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function coordKey(row, col) {
  return `${row},${col}`;
}

function numberFromValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeSide(value, fallback = 'black') {
  const side = String(value || '').trim().toLowerCase();
  if (['black', 'b', '1', 'x', 'first'].includes(side)) return 'black';
  if (['white', 'w', '2', 'o', 'second'].includes(side)) return 'white';
  return fallback;
}

function normalizeBoardSize(value, fallback = 15) {
  const size = Number(value);
  return Number.isInteger(size) && size >= 5 && size <= 50 ? size : fallback;
}

function normalizeCoordPair(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const row = numberFromValue(value[0]);
    const col = numberFromValue(value[1]);
    return row === undefined || col === undefined ? undefined : { row, col };
  }
  if (isRecord(value)) {
    const row = numberFromValue(value.row ?? value.r ?? value.y);
    const col = numberFromValue(value.col ?? value.column ?? value.c ?? value.x);
    return row === undefined || col === undefined ? undefined : { row, col };
  }
  if (typeof value === 'string') {
    const pair = value.match(/(-?\d+)\s*[, ]\s*(-?\d+)/);
    if (pair) return { row: Number(pair[1]), col: Number(pair[2]) };
  }
  return undefined;
}

function parseCoordinateText(text) {
  const coords = [];
  const pairPattern = /[\[(]?\s*(-?\d+)\s*,\s*(-?\d+)\s*[\])]*/g;
  for (const match of String(text || '').matchAll(pairPattern)) {
    coords.push({ row: Number(match[1]), col: Number(match[2]) });
  }
  const namedPattern = /\b([A-Z])\s*([1-9]\d*)\b/gi;
  for (const match of String(text || '').matchAll(namedPattern)) {
    coords.push({
      row: Number(match[2]) - 1,
      col: match[1].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
    });
  }
  return coords;
}

function parseCoordinates(value) {
  if (typeof value === 'string') return parseCoordinateText(value);
  if (!Array.isArray(value)) {
    const pair = normalizeCoordPair(value);
    return pair ? [pair] : [];
  }
  if (value.every((item) => !Array.isArray(item) && !isRecord(item)) && value.length % 2 === 0) {
    const flat = [];
    for (let i = 0; i < value.length; i += 2) {
      const pair = normalizeCoordPair([value[i], value[i + 1]]);
      if (pair) flat.push(pair);
    }
    return flat;
  }
  return value.map(normalizeCoordPair).filter(Boolean);
}

function matrixCellSide(value) {
  const cell = String(value ?? '').trim().toLowerCase();
  if (['1', 'b', 'black', 'x'].includes(cell)) return 'black';
  if (['2', 'w', 'white', 'o'].includes(cell)) return 'white';
  return undefined;
}

function parseMatrix(value) {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter(Array.isArray);
  if (!rows.length) return undefined;
  const black = [];
  const white = [];
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < rows[row].length; col += 1) {
      const side = matrixCellSide(rows[row][col]);
      if (side === 'black') black.push({ row, col });
      if (side === 'white') white.push({ row, col });
    }
  }
  return {
    boardSize: Math.max(rows.length, ...rows.map((item) => item.length)),
    black,
    white
  };
}

function parseTextMatrix(text) {
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[0-2BWXObwxo.,_\-\s]+$/.test(line))
    .map((line) => line.split(/[\s,]+/).filter(Boolean));
  if (rows.length < 5 || rows.some((row) => row.length < 5)) return undefined;
  return parseMatrix(rows);
}

function extractNamedCoordinates(text, names) {
  const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(text || '').match(new RegExp(`(?:${pattern})\\s*[:=]\\s*([^\\n;]+)`, 'i'));
  return match?.[1] ? parseCoordinateText(match[1]) : [];
}

function objectValue(source, keys) {
  if (!isRecord(source)) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function normalizeCoordinateSystem(value) {
  const system = String(value || '').trim().toLowerCase();
  if (system.startsWith('one') || system === '1' || system === '1-based' || system === 'one_based') return 'one_based';
  return 'zero_based';
}

function adjustCoordinateSystem(coords, coordinateSystem) {
  if (coordinateSystem !== 'one_based') return coords;
  return coords.map((coord) => ({ row: coord.row - 1, col: coord.col - 1 }));
}

function normalizeGomokuPayload(payload, fallbackBoardSize) {
  const source = Array.isArray(payload) ? { board: payload } : (isRecord(payload) ? payload : {});
  const matrix = parseMatrix(objectValue(source, ['board', 'matrix', 'grid', 'stonesMatrix', 'stones_matrix']));
  const coordinateSystem = normalizeCoordinateSystem(objectValue(source, ['coordinateSystem', 'coordinate_system', 'coordinates']));
  const boardSize = normalizeBoardSize(
    objectValue(source, ['boardSize', 'board_size', 'size', 'n']) ?? matrix?.boardSize,
    fallbackBoardSize
  );
  const blackRaw = [
    ...(matrix?.black || []),
    ...parseCoordinates(objectValue(source, ['black', 'blackStones', 'black_stones', 'b']))
  ];
  const whiteRaw = [
    ...(matrix?.white || []),
    ...parseCoordinates(objectValue(source, ['white', 'whiteStones', 'white_stones', 'w']))
  ];

  return {
    boardSize,
    sideToMove: normalizeSide(objectValue(source, ['sideToMove', 'side_to_move', 'turn', 'player']), 'black'),
    black: adjustCoordinateSystem(blackRaw, coordinateSystem),
    white: adjustCoordinateSystem(whiteRaw, coordinateSystem),
    coordinateSystem: 'zero_based'
  };
}

function extractGomokuPayload(body, fallbackBoardSize) {
  const content = String(body?.content || '').trim();
  const parts = Array.isArray(body?.message?.parts) ? body.message.parts : [];
  for (const part of parts) {
    if (part?.data !== undefined) return normalizeGomokuPayload(part.data, fallbackBoardSize);
    if (part?.raw !== undefined) return normalizeGomokuPayload(part.raw, fallbackBoardSize);
    if (typeof part?.text === 'string') {
      const parsed = tryParseJsonText(part.text);
      if (parsed !== undefined) return normalizeGomokuPayload(parsed, fallbackBoardSize);
    }
  }
  const parsed = tryParseJsonText(content);
  if (parsed !== undefined) return normalizeGomokuPayload(parsed, fallbackBoardSize);
  const matrix = parseTextMatrix(content);
  if (matrix) return normalizeGomokuPayload(matrix, fallbackBoardSize);
  return {
    boardSize: normalizeBoardSize((content.match(/\b(?:boardSize|board_size|size|n)\s*[:=]\s*(\d+)/i) || [])[1], fallbackBoardSize),
    sideToMove: normalizeSide((content.match(/\b(?:sideToMove|side_to_move|turn|player)\s*[:=]\s*([A-Za-z0-9_-]+)/i) || [])[1], 'black'),
    black: extractNamedCoordinates(content, ['black', 'blackStones', 'black_stones', 'b']),
    white: extractNamedCoordinates(content, ['white', 'whiteStones', 'white_stones', 'w']),
    coordinateSystem: 'zero_based'
  };
}

function validateGomokuBoard(board) {
  const occupied = new Map();
  for (const side of ['black', 'white']) {
    for (const coord of board[side]) {
      if (!Number.isInteger(coord.row) || !Number.isInteger(coord.col)) {
        throw new Error(`Invalid ${side} coordinate: ${safeJson(coord)}`);
      }
      if (coord.row < 0 || coord.col < 0 || coord.row >= board.boardSize || coord.col >= board.boardSize) {
        throw new Error(`Out-of-range ${side} coordinate: ${safeJson(coord)}`);
      }
      const key = coordKey(coord.row, coord.col);
      const previous = occupied.get(key);
      if (previous && previous !== side) throw new Error(`Both sides occupy coordinate: ${key}`);
      occupied.set(key, side);
    }
  }
}

function sideAt(board, row, col, extraMove) {
  if (extraMove && extraMove.row === row && extraMove.col === col) return extraMove.side;
  const key = coordKey(row, col);
  if (board.blackKeys.has(key)) return 'black';
  if (board.whiteKeys.has(key)) return 'white';
  return undefined;
}

function inBounds(boardSize, row, col) {
  return row >= 0 && col >= 0 && row < boardSize && col < boardSize;
}

function countDirection(board, row, col, side, dr, dc) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;
  while (inBounds(board.boardSize, nextRow, nextCol) && sideAt(board, nextRow, nextCol, { row, col, side }) === side) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }
  return count;
}

function openEnd(board, row, col, side, dr, dc) {
  let nextRow = row + dr;
  let nextCol = col + dc;
  while (inBounds(board.boardSize, nextRow, nextCol) && sideAt(board, nextRow, nextCol, { row, col, side }) === side) {
    nextRow += dr;
    nextCol += dc;
  }
  return inBounds(board.boardSize, nextRow, nextCol) && !sideAt(board, nextRow, nextCol, { row, col, side });
}

function lineStrength(board, row, col, side, dr, dc) {
  const stones = 1 + countDirection(board, row, col, side, dr, dc) + countDirection(board, row, col, side, -dr, -dc);
  const openEnds = Number(openEnd(board, row, col, side, dr, dc)) + Number(openEnd(board, row, col, side, -dr, -dc));
  return { stones, openEnds };
}

function hasFive(board, row, col, side) {
  return [[1, 0], [0, 1], [1, 1], [1, -1]]
    .some(([dr, dc]) => lineStrength(board, row, col, side, dr, dc).stones >= 5);
}

function scoreLine({ stones, openEnds }) {
  if (stones >= 5) return 1000000;
  if (stones === 4 && openEnds === 2) return 100000;
  if (stones === 4 && openEnds === 1) return 20000;
  if (stones === 3 && openEnds === 2) return 5000;
  if (stones === 3 && openEnds === 1) return 1000;
  if (stones === 2 && openEnds === 2) return 350;
  if (stones === 2 && openEnds === 1) return 80;
  if (stones === 1 && openEnds === 2) return 20;
  return 1;
}

function scoreMove(board, row, col, side) {
  const opponent = side === 'black' ? 'white' : 'black';
  const center = (board.boardSize - 1) / 2;
  let score = Math.max(0, 100 - Math.abs(row - center) * 8 - Math.abs(col - center) * 8);
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    score += scoreLine(lineStrength(board, row, col, side, dr, dc));
    score += scoreLine(lineStrength(board, row, col, opponent, dr, dc)) * 0.8;
  }
  return score;
}

function createGomokuBoard(payload) {
  validateGomokuBoard(payload);
  return {
    ...payload,
    blackKeys: new Set(payload.black.map((coord) => coordKey(coord.row, coord.col))),
    whiteKeys: new Set(payload.white.map((coord) => coordKey(coord.row, coord.col)))
  };
}

function emptyCells(board) {
  const cells = [];
  for (let row = 0; row < board.boardSize; row += 1) {
    for (let col = 0; col < board.boardSize; col += 1) {
      if (!sideAt(board, row, col)) cells.push({ row, col });
    }
  }
  return cells;
}

function recommendGomokuMove(input) {
  const board = createGomokuBoard(input);
  const side = input.sideToMove;
  const opponent = side === 'black' ? 'white' : 'black';
  const cells = emptyCells(board);
  if (!cells.length) throw new Error('The Gomoku board is full.');

  let resultType = 'heuristic_move';
  let selected = cells.find((cell) => hasFive(board, cell.row, cell.col, side));
  if (selected) {
    resultType = 'winning_move';
  } else {
    selected = cells.find((cell) => hasFive(board, cell.row, cell.col, opponent));
    if (selected) resultType = 'blocking_move';
  }

  const ranked = cells
    .map((cell) => ({ ...cell, score: scoreMove(board, cell.row, cell.col, side) }))
    .sort((a, b) => b.score - a.score || Math.abs(a.row - a.col) - Math.abs(b.row - b.col) || a.row - b.row || a.col - b.col);

  if (!selected) selected = ranked[0];
  return {
    move: {
      row: selected.row,
      col: selected.col,
      coordinateSystem: 'zero_based'
    },
    side,
    resultType,
    alternatives: ranked
      .filter((cell) => cell.row !== selected.row || cell.col !== selected.col)
      .slice(0, 3)
      .map((cell) => ({ row: cell.row, col: cell.col, score: Math.round(cell.score) })),
    reason: resultType === 'winning_move'
      ? 'The selected move completes a five-in-a-row line.'
      : resultType === 'blocking_move'
        ? 'The selected move blocks the opponent from completing five in a row.'
        : 'The selected move has the best local line strength and center control score.',
    normalizedBoard: {
      boardSize: board.boardSize,
      black: input.black,
      white: input.white,
      sideToMove: side,
      coordinateSystem: 'zero_based'
    }
  };
}

function modeMatches(requestedMode, producedMode) {
  const requested = String(requestedMode || '').toLowerCase();
  const produced = String(producedMode || '').toLowerCase();
  if (!requested || !produced) return false;
  if (requested === '*/*' || requested === produced) return true;
  if (requested.endsWith('/*')) return produced.startsWith(requested.slice(0, -1));
  return false;
}

function wantsOutputMode(acceptedModes, producedMode, fallback = true) {
  if (!acceptedModes.length) return fallback;
  return acceptedModes.some((mode) => modeMatches(mode, producedMode));
}

function gomokuResultText(result) {
  return [
    `Recommended Gomoku move: [${result.move.row}, ${result.move.col}]`,
    `side: ${result.side}`,
    `result_type: ${result.resultType}`,
    result.reason
  ].join('\n');
}

function gomokuParts(result, text, acceptedModes) {
  const modes = normalizeModes(acceptedModes, []);
  const parts = [];
  if (wantsOutputMode(modes, 'application/json', true)) {
    parts.push({ data: result, mediaType: 'application/json' });
  }
  if (wantsOutputMode(modes, 'text/plain', true)) {
    parts.push({ text, mediaType: 'text/plain' });
  }
  return parts.length ? parts : [{ text, mediaType: 'text/plain' }];
}

function handlerPath(pluginConfig) {
  return normalizePath(pluginConfig?.path, '/momoai/a2a-handlers/gomoku');
}

function localRuntimeRegistry() {
  const key = Symbol.for('openclaw.a2a.localRuntime.v1');
  if (!globalThis[key]) {
    const handlers = new Map();
    globalThis[key] = {
      register(capabilityId, handler) {
        handlers.set(String(capabilityId || '').trim(), handler);
        return () => handlers.delete(String(capabilityId || '').trim());
      },
      async execute(input) {
        const handler = handlers.get(String(input?.capabilityId || '').trim()) ||
          handlers.get(String(input?.skill?.id || '').trim());
        return handler ? handler(input) : undefined;
      }
    };
  }
  return globalThis[key];
}

function buildGomokuResponse(body, fallbackBoardSize) {
  const result = recommendGomokuMove(extractGomokuPayload(body, fallbackBoardSize));
  const text = gomokuResultText(result);
  const parts = gomokuParts(result, text, body?.acceptedOutputModes);
  return {
    artifactName: 'gomoku_move',
    parts,
    metadata: {
      mediaType: parts.some((part) => part.data !== undefined) ? 'application/json' : 'text/plain'
    }
  };
}

export default definePluginEntry({
  id: 'momoai-gomoku-a2a-handler',
  name: 'MOMOAI Gomoku A2A Handler',
  description: 'Provides a local OpenClaw response handler for a Gomoku move capability.',
  register(api) {
    const path = handlerPath(api.pluginConfig);
    const fallbackBoardSize = normalizeBoardSize(api.pluginConfig?.defaultBoardSize, 15);
    localRuntimeRegistry().register('gomoku_move', (body) => buildGomokuResponse(body, fallbackBoardSize));
    api.registerHttpRoute({
      path,
      auth: 'plugin',
      match: 'exact',
      replaceExisting: true,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return true;
        }
        try {
          sendJson(res, 200, buildGomokuResponse(await readJson(req), fallbackBoardSize));
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return true;
      }
    });
    api.logger.info?.(`[momoai-gomoku-a2a-handler] registered ${path}`);
  }
});
