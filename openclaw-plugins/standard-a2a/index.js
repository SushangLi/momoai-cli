import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const tasks = new Map();

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizePath(value, fallback) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeModes(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : fallback;
}

function normalizeSkill(value, index) {
  const skill = isRecord(value) ? value : {};
  const id = normalizeString(skill.id || skill.capability_id || skill.capabilityId, `skill_${index + 1}`);
  return {
    id,
    name: normalizeString(skill.name, id),
    description: normalizeString(skill.description, ''),
    tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
    inputModes: normalizeModes(skill.inputModes || skill.input_modes, ['text/plain', 'application/json']),
    outputModes: normalizeModes(skill.outputModes || skill.output_modes, ['text/plain'])
  };
}

function normalizeSkillBinding(value, index) {
  const binding = isRecord(value) ? value : {};
  const skill = isRecord(binding.skill) ? binding.skill : {};
  const capabilityId = normalizeString(binding.capabilityId || binding.capability_id || binding.id, `capability_${index + 1}`);
  const skillId = normalizeString(skill.id || binding.skillId || binding.skill_id, '');
  const instructions = normalizeString(skill.instructions || binding.instructions, '');
  if (!capabilityId || !skillId || !instructions) return undefined;
  return {
    capabilityId,
    capabilityName: normalizeString(binding.capabilityName || binding.capability_name || binding.name, capabilityId),
    capabilityDescription: normalizeString(binding.capabilityDescription || binding.capability_description || binding.description, ''),
    inputModes: normalizeModes(binding.inputModes || binding.input_modes, ['text/plain', 'application/json']),
    outputModes: normalizeModes(binding.outputModes || binding.output_modes, ['text/plain']),
    skill: {
      id: skillId,
      name: normalizeString(skill.name || binding.skillName || binding.skill_name, skillId),
      description: normalizeString(skill.description || binding.skillDescription || binding.skill_description, ''),
      instructions
    }
  };
}

function defaultSkills() {
  return [
    {
      id: 'general_task',
      name: 'General task',
      description: 'Complete one standard A2A task through OpenClaw.',
      tags: ['openclaw'],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain']
    }
  ];
}

function normalizeService(serviceId, rawService) {
  const service = isRecord(rawService) ? rawService : {};
  const isDefault = serviceId === 'default';
  const endpointPath = normalizePath(service.endpointPath || service.upstreamPath, isDefault ? '/a2a' : `/a2a/${serviceId}`);
  const agentCardPath = normalizePath(service.agentCardPath, isDefault ? '/.well-known/agent-card.json' : `/.well-known/a2a/${serviceId}/agent-card.json`);
  const skills = Array.isArray(service.skills) ? service.skills.map(normalizeSkill).filter((skill) => skill.id && skill.name) : defaultSkills();
  const skillBindings = Array.isArray(service.skillBindings)
    ? service.skillBindings.map(normalizeSkillBinding).filter(Boolean)
    : [];
  const timeoutSeconds = Number(service.timeoutSeconds || 600);
  return {
    id: serviceId,
    enabled: service.enabled === undefined ? true : Boolean(service.enabled),
    endpointPath,
    agentCardPath,
    name: normalizeString(service.name, 'OpenClaw A2A Agent'),
    description: normalizeString(service.description, 'OpenClaw exposed through the standard Agent2Agent protocol.'),
    version: normalizeString(service.version, '0.1.0'),
    openclawBin: normalizeString(service.openclawBin, 'openclaw'),
    openclawAgent: normalizeString(service.openclawAgent, ''),
    timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds) : 600,
    skills: skills.length ? skills : defaultSkills(),
    skillBindings
  };
}

function normalizeServices(pluginConfig) {
  const servicesConfig = isRecord(pluginConfig?.services) ? pluginConfig.services : {};
  return Object.entries(servicesConfig)
    .map(([serviceId, service]) => normalizeService(serviceId, service))
    .filter((service) => service.enabled);
}

function originFromRequest(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1:18789';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
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

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function taskMessage(role, text, metadata = {}) {
  return {
    role,
    parts: [{ kind: 'text', text }],
    metadata
  };
}

function taskPartsMessage(role, parts, metadata = {}) {
  return {
    role,
    parts,
    metadata
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function decodeTextBytes(bytes, mimeType) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  const canDecode =
    normalizedMime.startsWith('text/') ||
    normalizedMime.includes('json') ||
    normalizedMime.includes('xml') ||
    normalizedMime.includes('yaml');
  if (!canDecode) return undefined;
  try {
    const buffer = Buffer.from(bytes, 'base64');
    if (buffer.byteLength > 64 * 1024) return `[decoded text omitted: ${buffer.byteLength} bytes exceeds 65536]`;
    return buffer.toString('utf8');
  } catch {
    return undefined;
  }
}

function filePartToText(part) {
  const file = isRecord(part?.file) ? part.file : part;
  const name = normalizeString(file?.name, 'unnamed');
  const mimeType = normalizeString(file?.mimeType, 'application/octet-stream');
  const uri = normalizeString(file?.uri || file?.url, '');
  if (uri) return `[file: ${name}; mimeType=${mimeType}; uri=${uri}]`;
  const bytes = typeof file?.bytes === 'string' ? file.bytes : '';
  if (!bytes) return `[file: ${name}; mimeType=${mimeType}]`;
  const decoded = decodeTextBytes(bytes, mimeType);
  if (decoded !== undefined) return `[file: ${name}; mimeType=${mimeType}]\n${decoded}`;
  return `[file: ${name}; mimeType=${mimeType}; base64Bytes=${bytes.length}]`;
}

function partToText(part) {
  const kind = String(part?.kind || part?.type || '').toLowerCase();
  if (typeof part?.text === 'string') return part.text.trim();
  if (kind === 'file' || part?.file || part?.bytes || part?.uri || part?.url) return filePartToText(part);
  if (kind === 'data' || part?.data !== undefined) return `data:\n${safeJson(part.data)}`;
  if (part?.raw !== undefined) return `raw:\n${safeJson(part.raw)}`;
  return '';
}

function contentFromMessage(message) {
  if (typeof message?.content === 'string') return message.content;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map(partToText)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function acceptedOutputModesFromParams(params) {
  const candidates = [
    params?.configuration?.acceptedOutputModes,
    params?.configuration?.accepted_output_modes,
    params?.metadata?.acceptedOutputModes,
    params?.metadata?.accepted_output_modes,
    params?.message?.metadata?.acceptedOutputModes,
    params?.message?.metadata?.accepted_output_modes
  ];
  for (const candidate of candidates) {
    const modes = normalizeModes(candidate, []);
    if (modes.length) return modes;
  }
  return [];
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

function capabilityIdFromParams(params) {
  return String(params?.metadata?.capability_id || params?.metadata?.capabilityId || params?.capability_id || params?.capabilityId || '').trim();
}

function skillBindingForRequest(service, params) {
  const capabilityId = capabilityIdFromParams(params);
  if (!capabilityId) return { capabilityId: '', binding: undefined };
  return {
    capabilityId,
    binding: service.skillBindings.find((item) => item.capabilityId === capabilityId)
  };
}

function promptWithSkillBinding(content, binding) {
  if (!binding) return content;
  return [
    'A2A capability selected by the caller:',
    `capability_id: ${binding.capabilityId}`,
    `capability_name: ${binding.capabilityName}`,
    binding.capabilityDescription ? `capability_description: ${binding.capabilityDescription}` : '',
    `input_modes: ${binding.inputModes.join(', ')}`,
    `output_modes: ${binding.outputModes.join(', ')}`,
    '',
    'Local skill binding for this capability:',
    `skill_id: ${binding.skill.id}`,
    `skill_name: ${binding.skill.name}`,
    binding.skill.description ? `skill_description: ${binding.skill.description}` : '',
    '',
    'Skill instructions:',
    binding.skill.instructions,
    '',
    'Execute this request according to the selected capability and local skill. Do not guess another capability.',
    '',
    'User request:',
    content
  ].filter(Boolean).join('\n');
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

function normalizeGomokuPayload(payload) {
  const source = Array.isArray(payload) ? { board: payload } : (isRecord(payload) ? payload : {});
  const matrix = parseMatrix(objectValue(source, ['board', 'matrix', 'grid', 'stonesMatrix', 'stones_matrix']));
  const coordinateSystem = normalizeCoordinateSystem(objectValue(source, ['coordinateSystem', 'coordinate_system', 'coordinates']));
  const boardSize = normalizeBoardSize(
    objectValue(source, ['boardSize', 'board_size', 'size', 'n']) ?? matrix?.boardSize,
    15
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

function extractGomokuPayload(params, content) {
  const parts = Array.isArray(params?.message?.parts) ? params.message.parts : [];
  for (const part of parts) {
    if (part?.data !== undefined) return normalizeGomokuPayload(part.data);
    if (part?.raw !== undefined) return normalizeGomokuPayload(part.raw);
    if (typeof part?.text === 'string') {
      const parsed = tryParseJsonText(part.text);
      if (parsed !== undefined) return normalizeGomokuPayload(parsed);
    }
  }
  const parsed = tryParseJsonText(content);
  if (parsed !== undefined) return normalizeGomokuPayload(parsed);
  const matrix = parseTextMatrix(content);
  if (matrix) return normalizeGomokuPayload(matrix);
  return {
    boardSize: normalizeBoardSize((String(content).match(/\b(?:boardSize|board_size|size|n)\s*[:=]\s*(\d+)/i) || [])[1], 15),
    sideToMove: normalizeSide((String(content).match(/\b(?:sideToMove|side_to_move|turn|player)\s*[:=]\s*([A-Za-z0-9_-]+)/i) || [])[1], 'black'),
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

function gomokuResultText(result) {
  return [
    `Recommended Gomoku move: [${result.move.row}, ${result.move.col}]`,
    `side: ${result.side}`,
    `result_type: ${result.resultType}`,
    result.reason
  ].join('\n');
}

function gomokuArtifactParts(result, text, acceptedModes) {
  const parts = [];
  if (wantsOutputMode(acceptedModes, 'application/json', true)) {
    parts.push({ kind: 'data', data: result, mimeType: 'application/json' });
  }
  if (wantsOutputMode(acceptedModes, 'text/plain', true)) {
    parts.push({ kind: 'text', text });
  }
  return parts.length ? parts : [{ kind: 'text', text }];
}

function isGomokuCapability(capabilityId, binding) {
  return capabilityId === 'gomoku_move' || binding?.skill?.id === 'gomoku_move';
}

function collectPayloadText(payloads) {
  return (Array.isArray(payloads) ? payloads : [])
    .map((payload) => payload && payload.isReasoning !== true && typeof payload.text === 'string' ? payload.text.trim() : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function safeFileName(value) {
  return String(value || 'session').replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 120) || 'session';
}

async function invokeOpenClaw(api, service, input, contextId) {
  if (!api.runtime?.agent?.runEmbeddedPiAgent) {
    throw new Error('OpenClaw embedded agent runtime is not available to this plugin.');
  }

  const cfg = api.runtime.config?.current?.() || api.config;
  const agentId = service.openclawAgent || undefined;
  const sessionId = `a2a-${safeFileName(contextId)}`;
  const stateDir = api.runtime.state?.resolveStateDir?.() || process.cwd();
  const sessionDir = join(stateDir, 'a2a-sessions');
  await mkdir(sessionDir, { recursive: true });

  const workspaceDir = agentId
    ? api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId)
    : cfg?.agents?.defaults?.workspace || process.cwd();
  const result = await api.runtime.agent.runEmbeddedPiAgent({
    sessionId,
    sessionKey: `agent:${agentId || service.id}:a2a:${contextId}`,
    ...(agentId ? { agentId } : {}),
    sessionFile: join(sessionDir, `${sessionId}.json`),
    workspaceDir,
    ...(agentId ? { agentDir: api.runtime.agent.resolveAgentDir(cfg, agentId) } : {}),
    config: cfg,
    prompt: input,
    timeoutMs: service.timeoutSeconds * 1000,
    runTimeoutOverrideMs: service.timeoutSeconds * 1000,
    runId: `a2a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: 'manual',
    disableMessageTool: true,
    sourceReplyDeliveryMode: 'none'
  });

  return collectPayloadText(result?.payloads) || 'OpenClaw task completed without text output.';
}

function buildAgentCard(req, service) {
  const origin = originFromRequest(req);
  const endpoint = `${origin}${service.endpointPath}`;
  const defaultInputModes = normalizeModes(service.skills.flatMap((skill) => skill.inputModes || []), ['text/plain', 'application/json']);
  const defaultOutputModes = normalizeModes(service.skills.flatMap((skill) => skill.outputModes || []), ['text/plain']);
  return {
    protocolVersion: '1.0.0',
    name: service.name,
    description: service.description,
    version: service.version,
    url: endpoint,
    supportedInterfaces: [
      { transport: 'JSONRPC', url: endpoint },
      { transport: 'HTTP+JSON', url: endpoint }
    ],
    defaultInputModes,
    defaultOutputModes,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true
    },
    skills: service.skills,
    securitySchemes: {},
    security: []
  };
}

async function handleSendMessage(api, service, requestId, params) {
  const content = contentFromMessage(params?.message);
  if (!content) return jsonRpcError(requestId, -32602, 'message/send requires at least one text, data, or file part');

  const { capabilityId, binding } = skillBindingForRequest(service, params);
  if (!capabilityId && service.skillBindings.length > 0) {
    return jsonRpcError(requestId, -32602, 'message/send requires metadata.capability_id so OpenClaw can select the bound local skill');
  }
  if (capabilityId && !binding) {
    return jsonRpcError(requestId, -32602, `Unknown or unbound capability_id: ${capabilityId}`);
  }

  const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const contextId = String(params?.metadata?.contextId || params?.contextId || taskId);
  const taskMetadata = { contextId, ...(capabilityId ? { capability_id: capabilityId, skill_id: binding?.skill.id } : {}) };
  const task = {
    id: taskId,
    contextId,
    status: {
      state: 'TASK_STATE_WORKING',
      message: taskMessage('agent', 'Working', taskMetadata)
    },
    artifacts: [],
    history: [params.message]
  };
  tasks.set(taskId, task);

  try {
    if (isGomokuCapability(capabilityId, binding)) {
      const acceptedModes = acceptedOutputModesFromParams(params);
      const gomoku = recommendGomokuMove(extractGomokuPayload(params, content));
      const text = gomokuResultText(gomoku);
      const parts = gomokuArtifactParts(gomoku, text, acceptedModes);
      task.status = {
        state: 'TASK_STATE_COMPLETED',
        message: taskPartsMessage('agent', parts, taskMetadata)
      };
      task.artifacts = [
        {
          artifactId: `artifact_${taskId}`,
          name: 'gomoku_move',
          parts,
          metadata: {
            ...taskMetadata,
            mimeType: parts.some((part) => part.kind === 'data') ? 'application/json' : 'text/plain'
          }
        }
      ];
      tasks.set(taskId, task);
      return jsonRpcResult(requestId, task);
    }

    const reply = await invokeOpenClaw(api, service, promptWithSkillBinding(content, binding), contextId);
    task.status = {
      state: 'TASK_STATE_COMPLETED',
      message: taskMessage('agent', reply, taskMetadata)
    };
    task.artifacts = [
      {
        artifactId: `artifact_${taskId}`,
        name: 'result',
        parts: [{ kind: 'text', text: reply }],
        metadata: {
          ...taskMetadata
        }
      }
    ];
    tasks.set(taskId, task);
    return jsonRpcResult(requestId, task);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = {
      state: 'TASK_STATE_FAILED',
      message: taskMessage('agent', message, taskMetadata)
    };
    tasks.set(taskId, task);
    return jsonRpcResult(requestId, task);
  }
}

async function handleJsonRpc(api, service, body) {
  const method = body?.method;
  if (body?.jsonrpc !== '2.0' || typeof method !== 'string') {
    return jsonRpcError(body?.id, -32600, 'Invalid JSON-RPC request');
  }
  if (method === 'message/send' || method === 'SendMessage') {
    return handleSendMessage(api, service, body.id, body.params || {});
  }
  if (method === 'tasks/get' || method === 'GetTask') {
    const taskId = String(body.params?.id || body.params?.taskId || '');
    const task = tasks.get(taskId);
    return task ? jsonRpcResult(body.id, task) : jsonRpcError(body.id, -32001, 'Task not found');
  }
  if (method === 'tasks/list' || method === 'ListTasks') {
    return jsonRpcResult(body.id, Array.from(tasks.values()));
  }
  if (method === 'tasks/cancel' || method === 'CancelTask') {
    const taskId = String(body.params?.id || body.params?.taskId || '');
    const task = tasks.get(taskId);
    if (!task) return jsonRpcError(body.id, -32001, 'Task not found');
    task.status = {
      state: 'TASK_STATE_CANCELED',
      message: taskMessage('agent', 'Canceled')
    };
    tasks.set(taskId, task);
    return jsonRpcResult(body.id, task);
  }
  return jsonRpcError(body.id, -32601, `Unsupported A2A method: ${method}`);
}

function registerJsonRoute(api, path, handler, match = 'exact') {
  api.registerHttpRoute({
    path,
    auth: 'plugin',
    match,
    replaceExisting: true,
    handler
  });
}

function registerService(api, service) {
  registerJsonRoute(api, service.agentCardPath, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    sendJson(res, 200, buildAgentCard(req, service));
    return true;
  });

  registerJsonRoute(api, service.endpointPath, async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      sendJson(res, 200, await handleJsonRpc(api, service, await readJson(req)));
    } catch (error) {
      sendJson(res, 400, jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error)));
    }
    return true;
  });

  registerJsonRoute(api, `${service.endpointPath}/message:send`, async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const response = await handleSendMessage(api, service, null, await readJson(req));
      sendJson(res, 200, response.result || response);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  });

  registerJsonRoute(api, `${service.endpointPath}/tasks/`, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const taskId = decodeURIComponent(String(req.url || '').split('/tasks/')[1]?.split('?')[0] || '');
    const task = tasks.get(taskId);
    sendJson(res, task ? 200 : 404, task || { error: 'Task not found' });
    return true;
  }, 'prefix');

  api.logger.info?.(`[openclaw-standard-a2a] registered ${service.id}: ${service.agentCardPath}, ${service.endpointPath}`);
}

export default definePluginEntry({
  id: 'openclaw-standard-a2a',
  name: 'OpenClaw Standard A2A',
  description: 'Exposes OpenClaw as a spec-compatible A2A agent endpoint.',
  register(api) {
    const services = normalizeServices(api.pluginConfig);
    for (const service of services) registerService(api, service);
    if (!services.length) api.logger.warn?.('[openclaw-standard-a2a] no enabled services configured');
  }
});
