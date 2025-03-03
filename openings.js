import { Chessground     } from './dist/chessground/src/chessground.js';
import { Chess, SQUARES  } from './dist/chess.js/dist/esm/chess.js';
//import { repertoires     } from './repertoires.js';
import { book            } from './opening-book.js';
import { SRS             } from './spaced-repetition.js';

if (typeof localStorage == 'undefined') {
	alert("web storage is not supported");
	throw "no web storage";
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

const DEFAULT_REPERTOIRES = {
	white: "sesenar",
	black: "tholtia"
}

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
	constructor(repertoire, color, moves, number_of_extended_moves = 0) {
		this.repertoire = repertoire;
		this.color      = color;
		this.moves = (typeof moves === 'string') ? moves.match(halfMoveRegex) : moves;
		this.number_of_extended_moves = number_of_extended_moves;
		if (this.moves.length == 0)
			throw `could not build line from ${moves}`;
	}
	pack() {
		return [
			this.repertoire,
			this.color,
			this.moves.join(''),
			this.number_of_extended_moves
		].join('/')
	}
	pgn() {
		let chess = new Chess();
		for (let move of this.moves) chess.move(move);
		return chess.pgn();
	}
	extend(moves) {
		return new Line(this.repertoire, this.color, this.moves.concat(moves), moves.length);
	}
}

function unpack(line) {
	if (typeof line === 'string') {
		let     split      = line.split('/'),
			repertoire = split[0],
			color      = split[1],
			moves      = split[2],
			number_of_extended_moves = split[3];
		return new Line(repertoire, color, moves, number_of_extended_moves);
	} else { throw "unexpected argument type" }
}

class Repertoire {
	constructor(name, color, lines) {
		this.name = name;
		this.color = color;
		this.lines = lines;
	}
}

async function main(lines) {
	let srs = new SRS(storage, lines.map(x => x.pack()));

	while (true) {
		for (let div of ['info', 'pgn']) {
			log(`clearing ${div}`);
			document.getElementById(div).innerHTML = '';
		}
		setTimeout(() => { log("clearing stats"); document.getElementById("stats").innerHTML = '' }, 5000);

		let     pick    = srs.pick(),
			line    = unpack(pick),
			success = await quiz(line);

		if (success) { srs.pass(line.pack()); }
		else         { srs.fail(line.pack()); }

		document.getElementById("stats").innerHTML = Array.from(srs.stats.values()).join('/');
	}
}

Promise.all(
	Array.from(
		function *() {
			for (let color of ['white', 'black']) {
				let name = DEFAULT_REPERTOIRES[color];
				yield fetch(`./repertoires/${color}/${name}.txt`)
					.then(x => x.text())
					.then(text => text.split("\n").filter(x => x))
					.then(compacted_lines => compacted_lines.map(l => new Line(name, color, l)))
					.then(lines => new Repertoire(name, color, lines));
			}
		}()
	).concat([
		fetch("stockfish-evals.jsonl")
			.then(x => x.text())
			.then(text => text.trim().split("\n"))
			.then(
				arr  => {
					let evals = {}
					for (let x of arr) {
						let data = JSON.parse(x);
						evals[data.fen] = data.evals
					}
					return evals;
				}
			)
	])
).then(
	function (x) {
		let     lines = x[0].lines.concat(x[1].lines),
			evals = x[2],
			extended_lines = [];

		for (let line of lines) {
			let last_fen = [new Chess(), ...line.moves].reduce((a,b) => { a.move(b); return a; })
				.fen()
				.split(' ')
				.splice(0, 4)
				.join(' ');

			if (evals[last_fen]) {
				let deepest_eval = evals[last_fen].reduce((a,b) => a.depth > b.depth ? a : b);
				if (line.moves.length % 2 == 0) {
					if (line.color == 'white') {
						//console.info('Type I');
						let pv = deepest_eval['pvs'].reduce((a, b) => a.cp > b.cp ? a : b),
							uci_moves = pv['line'].split(' '),
							chess = new Chess(last_fen),
							san_moves = [];
						for (let uci_move of uci_moves) {
							let move = chess.move(fix_wrong_uci(chess.fen(), uci_move), { verbose: true });
							san_moves.push(move.san)
						}
						extended_lines.push(line.extend(san_moves));
					} else {
						//console.info('Type II');
						//console.info(`adding ${deepest_eval['pvs'].length} lines`);
						for (let pv of deepest_eval['pvs']) {
							let chess = new Chess(last_fen),
								uci_moves = pv['line'].split(' '),
								san_moves = [];
							for (let uci_move of uci_moves) {
								let move = chess.move(fix_wrong_uci(chess.fen(), uci_move));
								san_moves.push(move.san);
							}
							extended_lines.push(line.extend(san_moves));
						}
					}
				} else {
					if (line.color == 'white') {
						//console.info('Type III');
						//log(line.moves);
						for (let pv of deepest_eval['pvs']) {
							let chess = new Chess(last_fen),
								uci_moves = pv['line'].split(' '),
								san_moves = [];
							for (let uci_move of uci_moves) {
								let move = chess.move(fix_wrong_uci(chess.fen(), uci_move));
								san_moves.push(move.san);
							}
							extended_lines.push(line.extend(san_moves));
						}
					} else {
						//console.info('Type IV');
						let pv = deepest_eval['pvs'].reduce((a, b) => a.cp < b.cp ? a : b),
							uci_moves = pv['line'].split(' '),
							chess = new Chess(last_fen),
							san_moves = [];
						for (let uci_move of uci_moves) {
							let move = chess.move(fix_wrong_uci(chess.fen(), uci_move), { verbose: true });
							san_moves.push(move.san)
						}
						extended_lines.push(line.extend(san_moves));
					}
				}
			} else {
				console.warn('found one line with no eval at the end');
				extended_lines.push(line);
			}

		}
		return extended_lines;
	}
).then(main)

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
	let chess = new Chess(),
		color = line.color,
		moves = [...line.moves], // for cloning
		board = Chessground(document.getElementById('chessboard'), {});

	if (color == 'black') {
		// make first move
		if (moves.length > 0) {
			let move = chess.move(moves.shift());
			//board.move(move.from, move.to);
			makeMove(board, move);
			//document.getElementById('soundMove').play();
		}
	}

	return new Promise(
		(resolve, reject) => {
			board.set(
				{
					orientation: color,
					selectable: { enable: true },
					events: {
						change: () => {
							document.getElementById("info").innerHTML = identifyOpening(chess.history().join(''));
							document.getElementById("pgn" ).innerHTML = chess.pgn();
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
											} else if (moves.length <= line.number_of_extended_moves) {
												document.querySelector('cg-board').style.backgroundColor = 'lightgrey';
											}


										} else {
											document.getElementById('soundWrong').play();
											log(`wrong move: ${expected_move} was expected`);
											chess.undo();
											board.set({ fen: chess.fen() });
											let move = chess.move(expected_move);
											//board.move(move.from, move.to);
											makeMove(board, move);
											board.stop();
											await sleep(PENALITY_DELAY);
											resolve(false);
											//alert(`wrong move! ${expected_move} was expected.`);
										}
									}
									catch (err) {
										board.set({ fen: chess.fen() });
										console.warn(err);
									}
								} else { console.warn("unexpected user input, stopping board"); board.stop(); }
							}
						}
					}
				}
			);
		});
}

