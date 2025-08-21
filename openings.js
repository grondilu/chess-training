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
		    if ("nags" in move)
			if (['$2', '$6'].some(x => move.nags.includes(x))) {
			    console.log(`move ${move.move} is a bad one.  Hopefully a better one is in the variations$`);
			    if (move.ravs.length > 1) { throw "dealing with multiple variations for the repertoire color is NYI"; }
			    else {
				console.log(move);
				console.warn("switching to alternate line");
				_extractLines(move.ravs[0].moves, [...localPrefix]);
				return result;
			    }
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
function log(msg) { if (DEBUG) console.log(msg); }
function pick(array) { return array[Math.floor(Math.random()*array.length)] }

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

function makeMove(board, move) {
    board.move(move.from, move.to);
    if (move.isEnPassant()) {
	let row = board.orientation == 'white' ? 4 : 5,
	    col = move.to.substr(0, 1);
	board.setPieces(new Map([[col+row], [false]]));
    }
}

class Line {
    constructor(moves, color, start = undefined) {
	this.moves = (typeof moves === 'string') ? moves.match(halfMoveRegex) : moves;
	this.start = start;
	this.color = color;

	if (this.moves.length == 0)
	    throw `could not build line from ${moves}`;
    }
    pack() {
	return [
	    this.start,
	    this.color === white ? 'w' : 'b',
	    this.moves.join('')
	].join('§')
    }
    pgn() {
	let chess = new Chess(),
	    moves = [];
	if (this.start)
	    for (let move of STANDARD_MOVE_ORDERS[OPENING_ASSUMPTIONS[this.start]].match(halfMoveRegex))
		chess.move(move);
	for (let move of this.moves) chess.move(move);
	return chess.pgn();
    }
}

function unpack(line) {
	if (typeof line === 'string') {
		let     split      = line.split('§'),
			start      = split[0],
			color      = split[1] === 'w' ? white : black,
			moves      = split[2];
		return new Line(moves, color, start == '' ? undefined : start);
	} else { throw "unexpected argument type" }
}

var lines = [];

async function main() {

    console.log(`loading ${lines.length} lines`);
    console.log(lines);
    let srs     = new SRS(storage, lines.map(x => x.pack()));

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

	let line    = unpack(pick),
	    success = await quiz(line);

	if (success) { srs.pass(line.pack()); }
	else         { srs.fail(line.pack()); }

	document.getElementById("stats").innerHTML = Array.from(srs.stats.values()).join('/');
    }
}

// load repertoire from disk into memory
Promise.all(
    function *() {
	for (
	    let pgn of [
		"./repertoires/white/Caro-Kann/Shaw/Jouez 1.e4!/I.pgn",
		"./repertoires/black/Nimzo-Indian/Swiercz/I/chapter-1.pgn",
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
				let start = header.FEN;
				lines.push(
				    new Line(
					moves.map($ => $.move.replace(/[?!]/g, '')),
					color,
					header.FEN
				    )
				);
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

async function quiz(line) {
    console.log(line);
    let chess = new Chess(),
	color = line.color,
	orientation  = getColor(color) === white ? 'white' : 'black',
	moves = [...line.moves], // for cloning
	board = Chessground(document.getElementById('chessboard'), {});

    if (line.start) {
	chess.load(line.start);
	board.set({ fen: line.start });
    }

    log([line, color, orientation, getColor(chess.turn())]);
    if (getColor(color) !== getColor(chess.turn())) {
	// make first move
	if (moves.length > 0) {
	    let move = chess.move(moves.shift());
	    //board.move(move.from, move.to);
	    makeMove(board, move);
	    //document.getElementById('soundMove').play();
	}
    } else {
	log({ color: getColor(color), turn: chess.turn() });
	log({ fen: line.start, newturn: getColor(chess.turn()) });
    }

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
					log(["chosen move is :", move.san]);
					makeMove(board, move);
					// Is the user's move the expected one?
					if (move.san == expected_move) {
					    log("good move");
					    //   - shift moves
					    //   - make next half-move if defined
					    if (moves.length > 0) {
						let nextmove = chess.move(moves.shift());
						//board.move(nextmove.from, nextmove.to);
						makeMove(board, nextmove);
						board.set({ movable: { dests: toDests(chess) } });
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
					    log(`wrong move: ${expected_move} was expected`);
					    chess.undo();
					    board.set({ fen: chess.fen() });
					    let move = chess.move(expected_move);
					    //board.move(move.from, move.to);
					    makeMove(board, move);
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
