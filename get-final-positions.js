const { Chess } = require('chess.js');
const fs = require('fs');

// Your regex
const halfMoveRegex = /(?:O-O(?:-O)?|[KQBNR](?:[a-h]|[1-8]|[a-h][1-8])??x?[a-h][1-8]|(?:[a-h]x)?[a-h][1-8](?:=[QBNR])?)\+?!?/g;

function parseLineToFen(line) {
    const chess = new Chess();
    const moves = line.match(halfMoveRegex) || [];
    for (const move of moves) {
        chess.move(move, { sloppy: true }); // Allows flexible SAN parsing
    }
    // Return FEN up to en passant (matches your DB)
    return chess.fen().split(' ').slice(0, 4).join(' ');
}

// Read from stdin or file
const input = fs.readFileSync(0, 'utf-8'); // 0 = stdin
const lines = input.trim().split('\n');

lines.forEach(line => {
    if (line) {
        try {
            const fen = parseLineToFen(line);
	    //console.log(`Line: ${line}`);
            //console.log(`FEN: ${fen}\n`);
	    console.log(fen);
        } catch (e) {
            console.error(`Error parsing '${line}': ${e.message}\n`);
        }
    }
});
