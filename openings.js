import { Chessground     } from './dist/chessground/src/chessground.js';
import { Chess, SQUARES  } from './dist/chess.js/dist/esm/chess.js';
import { book            } from './opening-book.js';
import { SRS             } from './spaced-repetition.js';
import { zobrist_hash    } from './zobrist.js';

if (typeof localStorage == 'undefined') {
	alert("web storage is not supported");
	throw "no web storage";
}

const white = Symbol('White');
const black = Symbol('Black');
function swapColor(color) { return color == white ? black : white }
function getColor(c) { 
    switch (c) {
	case white: return white; break;
	case black: return black; break;
	default: return /^[wW](hite)?$/.test(c) ? white : black;
    }
}

const OPENING_ASSUMPTIONS = {
    "rnbqk2r/pppp1ppp/4pn2/8/1bPP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 2 4": "Nimzo-Indian Defense",
    "rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3": "Caro Kann Defense — Advanced Variation"
}

const STANDARD_MOVE_ORDERS = {
    "Nimzo-Indian Defense": "1.d4 Nf6 2.c4 e6 3.Nc3 Bb4",
    "Caro Kann Defense — Advanced Variation": "1.e4 c6 2.d4 d5 3.e5"
}

const MOVE_PREFERENCES = {
    [zobrist_hash("r1bqkbnr/pppp1ppp/2n5/8/3pP3/2P2N2/PP3PPP/RNBQKB1R b KQkq - 0 4")]: "d5" 
}

function get_nag_priority(nags) {
    /*
    Assign a priority score based on NAGs:
    - 3 (!!): 4 (brilliant)
    - 1 (!): 3 (good)
    - 5 (!?): 2 (interesting)
    - no NAG: 1 (neutral)
    - others (negative): 0
    */

    if      (nags === undefined)    return 1;
    else if (nags.includes('$3'))   return 4;
    else if (nags.includes('$1'))   return 3;
    else if (nags.includes('$5'))   return 2;
    else                            return 0;
}

function extractLines(game, color) {

    let result = [],
	header;
    let move_number = 0,
	first_turn  = white;
    if ("headers" in game) {
	header = Object.fromEntries(game.headers.map($ => [$.name, $.value]));
	if ("FEN" in header) {
	    if (header.FEN.match(/ w /)) first_turn = black;
	    move_number = +header.FEN.replace(/.* /, '');
	}
    }

    (function _extractLines(moves, prefix = []) {
	let localPrefix = [...prefix],
	    turn = localPrefix.length % 2 == 1 ? black : white;
	for (const move of moves) {
	    if ("ravs" in move)
		if (color && color !== turn) {
		    for (let rav of move.ravs) {
			_extractLines(rav.moves, [...localPrefix]);
		    }
		} else {
		    if (move.ravs.length > 1) {
			console.log({ moves, move });
			throw "dealing with multiple variations for the repertoire color is NYI";
		    }
		    else if (get_nag_priority(move.ravs[0].moves[0].nags) > get_nag_priority(move.nags)) {
			console.warn("switching to alternate line");
			_extractLines(move.ravs[0].moves, [...localPrefix]);
			return result;
		    }
		}
	    localPrefix.push(move);
	    turn = swapColor(turn);
	}
	result.push(localPrefix);
    })(game.moves);

    return result;
}

const DEBUG = false;
const storage = DEBUG ? sessionStorage : localStorage;
function log(msg)    { if (DEBUG) console.log(msg); }
function pick(array) { return array[Math.floor(Math.random()*array.length)] }

/*
function fix_wrong_uci(fen, uci_move) {
	if (uci_move == 'e1h1' || uci_move == 'e1a1' || uci_move == 'e8h8' || uci_move == 'e8a8') {
		let     chess          = new Chess(fen),
			possible_moves = chess.moves({ verbose: true });
		if (uci_move == 'e1h1' && possible_moves.filter(m => m.lan == 'e1g1' && m.isKingsideCastle()).length  > 0) return 'e1g1';
		if (uci_move == 'e1a1' && possible_moves.filter(m => m.lan == 'e1c1' && m.isQueensideCastle()).length > 0) return 'e1c1';
		if (uci_move == 'e8h8' && possible_moves.filter(m => m.lan == 'e8g8' && m.isKingsideCastle()).length  > 0) return 'e8g8';
		if (uci_move == 'e8a8' && possible_moves.filter(m => m.lan == 'e8c8' && m.isQueensideCastle()).length > 0) return 'e8c8';
	}
	return uci_move;
}
*/

const halfMoveRegex = /(?:O-O(?:-O)?|[KQBNR](?:[a-h]|[1-8]|[a-h][1-8])??x?[a-h][1-8]|(?:[a-h]x)?[a-h][1-8](?:=[QBNR])?)\+?!?/g;

const toDests = chess => {
	let dests = new Map();
	SQUARES.forEach((s) => {
		const ms = chess.moves({ square: s, verbose: true });
		if (ms.length) dests.set(s, ms.map((m) => m.to));
	});
	return dests;
};

const AUTOMOVE_DELAY = 500; //ms
const PENALITY_DELAY = 5000; //ms

// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function makeMove(board, move, fen) {
    board.move(move.from, move.to);
    if (move.isEnPassant()) {
	board.set({ fen });
    }
}

function pack({ header, moves, color }) {
    return [
	"FEN" in header ? header.FEN : '',
	color === white ? 'w' : 'b',
	moves.map(move => move.move).join('')
    ].join('§');
}

var lines = {};

async function main() {

    let index = {};
    // First pass: build repertoire index
    for (let line of Object.values(lines)) {
	let game = new Chess();
	for (let move of line.moves) {
	    let fen   = game.fen(),
	        zhash = zobrist_hash(fen);
	    if (index[zhash] == undefined) index[zhash] = { fen, lines: [], moves: { [white]: new Set(), [black]: new Set() } }
	    index[zhash].lines.push(line);
	    index[zhash].moves[line.color].add(move.move);
	    game.move(move.move);
	}
    }

    // Second pass: enforce repertoire consistency.
    for (let line of Object.values(lines)) {
	let game = new Chess();
	for (let move of line.moves) {
	    let fen   = game.fen(),
	        zhash = zobrist_hash(fen);
	    if (index[zhash] == undefined) index[zhash] = { fen, lines: [], moves: { [white]: new Set(), [black]: new Set() } }
	    index[zhash].lines.push(line);
	    index[zhash].moves[line.color].add(move.move);
	    if (line.color == getColor(game.turn()) && index[zhash].moves[line.color].size > 1) {
		if (move.move !== MOVE_PREFERENCES[zhash]) {
		    console.log(`marking ${move.move} in position ${fen} as alternative line`);
		    line.alternative = true;
		}
	    }
	    game.move(move.move);
	}
    }

    // Third pass: handle transpositions
    for (let line of Object.values(lines)) {
	let game = new Chess();
	for (let move of line.moves) game.move(move.move);
	let fen   = game.fen(),
	    zhash = zobrist_hash(fen);
	if (index[zhash] !== undefined) {
	    let transpositions = index[zhash].lines.filter(x => x.color == line.color);
	    if (transpositions.length > 0) {
		delete lines[pack(line)];
		let { color, header, moves } = line;
		for (let transposition of transpositions) {
		    let game = new Chess(),
			moves = [];
		    for (let move of transposition.moves) moves.push(move);
		    while (moves.length > 0) {
			if (zobrist_hash(game.fen()) == zhash) {
			    let newline = { color, header, moves: line.moves.concat(moves), transposition: { fen: game.fen(), pgn: game.pgn() } };
			    lines[pack(newline)] = newline;
			    break;
			}
			game.move(moves.shift().move);
		    }
		}
	    }
	}
    }

    let srs     = new SRS(storage, Object.keys(lines).filter(k => !lines[k].alternative));

    while (true) {
	for (let div of ['info', 'pgn']) {
	    log(`clearing ${div}`);
	    document.getElementById(div).innerHTML = '';
	}
	setTimeout(() => { log("clearing stats"); document.getElementById("stats").innerHTML = '' }, 5000);

	let     pick;
	try { pick    = srs.pick(); }
	catch(err) {
	    document.getElementById('info').innerHTML = "error: " + err;
	    log(err);
	    break;
	}

	let line    = lines[pick],
	    success = await quiz(line, srs);

	if (success) { srs.pass(pick); }
	else         { srs.fail(pick); }

	document.getElementById("stats").innerHTML = Array.from(srs.stats.values()).join('/');
    }
}

// load repertoire from disk into memory
Promise.all(
    function *() {
	for (
	    let pgn of [
		"./repertoires/black/swiercz - Nimzo Indian - I.pgn",
		"./repertoires/black/ntirlis - jouez 1.e4 e5!.pgn",
		"./repertoires/white/shaw - jouez 1.e4! - I.pgn"
	    ]
	) {
	    let color = pgn.match(/\/white\//) ? white : black;
		yield fetch(pgn)
		.then(file => file.text())
		.then(
		    function (text) {
			let games = pgnParser.parse(text, { startRule: "games" });
			for (let game of games) {
			    let header          = Object.fromEntries(game.headers.map($ => [$.name, $.value])),
				extracted_lines = extractLines(game, color);
			    for (let moves of extracted_lines) {
				let start = header.FEN,
				    line = { header, moves, color };
				lines[pack(line)] = line;
			    };
			}
		    }
		)
	}
}()
).then(main);

function identifyOpening(compacted_moves) {
	if (compacted_moves == '') return "starting position"; 
	return book
		.filter(x => compacted_moves.substr(0, x[2].length) == x[2])
		// https://chatgpt.com/share/6790de81-57fc-8001-bd96-65afd0006857
		.reduce((min, item) => min[2].length < item[2].length ? item : min)[1]
}
/* Test identifyOpening
	var line = repertoire.white[35];
	log(line);
	log(identifyOpening(line));
	*/

async function quiz(line, srs) {
    if (line == undefined) throw "nothing to quiz";
    if (line.transposition) console.warn(`this is a transposition from ${line.transposition.from}`);
    let chess = new Chess(),
	header = line.header,
	color = line.color,
	orientation  = color === white ? 'white' : 'black',
	moves = [...line.moves], // for cloning
	board = Chessground(document.getElementById('chessboard'), {}),
	{ score, time } = JSON.parse(srs.storage[pack(line)]);

    /* example for drawing arrows
    board.set({
	drawable: {
	    shapes: [
		{
		    orig:  "e2",
		    dest:  "e4",
		    brush: "blue"
		}
	    ]
	}
    });
    */

    if ("FEN" in header) {
	chess.load(header.FEN);
	board.set({ fen: header.FEN });
    }

    log({ line, color, orientation, turn: getColor(chess.turn())});
    if (color !== getColor(chess.turn())) {
	log("making first move");
	// make first move
	if (moves.length > 0) {
	    let move = chess.move(moves.shift().move);
	    //board.move(move.from, move.to);
	    makeMove(board, move, chess.fen());
	    //document.getElementById('soundMove').play();
	}
    }

    function show() {
	if (moves.length > 0) {
	    let move = chess.move(moves[0].move);
	    board.set({
		drawable: {
		    shapes: [
			{
			    orig:  move.from,
			    dest:  move.to,
			    brush: "blue"
			}
		    ]
		}
	    });
	    chess.undo();
	}
    };

    if (Math.random() < 1/2**(score+1)) show();

    return new Promise(
	(resolve, reject) => {
	    board.set(
		{
		    orientation,
		    selectable: { enable: true },
		    events: {
			change: () => {
			    let pgn = '';
			    if (line.start)
				document.getElementById("pgn").innerHTML = pgn = STANDARD_MOVE_ORDERS[OPENING_ASSUMPTIONS[line.start]];
			    pgn += chess.pgn().replaceAll(/\[.*\] ?/g, '');
			    log({chess, pgn, moves: STANDARD_MOVE_ORDERS[OPENING_ASSUMPTIONS[line.start]], start: line.start });
			    if (pgn !== '')
				document.getElementById("info").innerHTML = identifyOpening(pgn.match(halfMoveRegex).join(''));
			    document.getElementById("pgn").innerHTML = pgn.replaceAll(/\[.*\] ?/g, '');
			},
		    },
		    movable: {
			free: false,
			dests: toDests(chess),
			showDests: true,
			events: {
			    after: async (from, to, metadata) => {
				document.getElementById('soundMove').play();
				if (moves.length > 0) {
				    try {
					let move = chess.move({ from, to }),
					    expected_move = moves.shift();
					log({move});
					makeMove(board, move, chess.fen());
					if (expected_move.comments.length > 0)
					    for (let comment of expected_move.comments) {
						console.log(comment);
						if ("text" in comment)
						    chess.setComment(comment.text);
						if ("commands" in comment) 
						    for (let command of comment.commands)
							if ("key" in command && command.key == "draw")
							    console.log(command.value);
					    }
					// Is the user's move the expected one?
					if (move.san == expected_move.move.replaceAll(/[!?]*/g, '')) {
					    log("good move");
					    //   - shift moves
					    //   - make next half-move if defined
					    if (moves.length > 0) {
						let nextmove = chess.move(moves.shift().move);
						//board.move(nextmove.from, nextmove.to);
						makeMove(board, nextmove, chess.fen());
						board.set({ movable: { dests: toDests(chess) } });
						if (Math.random() < 1/2**(score+1)) show();
						document.getElementById('soundMove').play();
					    }
					    if (moves.length == 0) {
						document.getElementById('soundSuccess').play();
						log("success! locking board");
						board.stop();
						resolve(true);
					    }
					}
					else {
					    document.getElementById('soundWrong').play();
					    log(`wrong move: ${expected_move.move} was expected`);
					    chess.undo();
					    board.set({ fen: chess.fen() });
					    let move = chess.move(expected_move.move);
					    //board.move(move.from, move.to);
					    makeMove(board, move, chess.fen());
					    console.log(`http://lichess.org/analysis/pgn/${chess.history().join('_')}`, "_blank");
					    board.stop();
					    log("sleeping 1s");
					    await sleep(PENALITY_DELAY)
					    log("resolving to false");
					    resolve(false);
					}
				    }
				    catch (err) {
					board.set({ fen: chess.fen() });
					console.warn(["caught error", err]);
				    }
				}
				else { console.warn("unexpected user input, stopping board"); board.stop(); }
			    }
			}
		    }
		}
	    );
	});
}

// vi: shiftwidth=4
