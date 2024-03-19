'use strict';

// some ES6 symbols
// https://chat.openai.com/share/3bca29af-2da5-4469-98e5-378e045c697c
const
  BLACK  = Symbol('color'),
  WHITE  = Symbol('color'),

  KING   = Symbol('chess piece'),
  QUEEN  = Symbol('chess piece'),
  ROOK   = Symbol('chess piece'),
  BISHOP = Symbol('chess piece'),
  KNIGHT = Symbol('chess piece'),
  PAWN   = Symbol('chess piece'),

  SHORT  = Symbol('castling type'),
  LONG   = Symbol('castling type');

// Unicode chess symbols
// https://en.wikipedia.org//wiki/Chess_symbols_in_Unicode
const UNICODE_CHESS_SYMBOLS = {
  [WHITE]: {
    [KING]:   { html: "&#9812;", character: '♔' },
    [QUEEN]:  { html: "&#9813;", character: '♕' },
    [ROOK]:   { html: "&#9814;", character: '♖' },
    [BISHOP]: { html: "&#9815;", character: '♗' },
    [KNIGHT]: { html: "&#9816;", character: '♘' },
    [PAWN]:   { html: "&#9817;", character: '♙' }
  },
  [BLACK]: {
    [KING]:   { html: "&#9818;", character: '♚' },
    [QUEEN]:  { html: "&#9819;", character: '♛' },
    [ROOK]:   { html: "&#9820;", character: '♜' },
    [BISHOP]: { html: "&#9821;", character: '♝' },
    [KNIGHT]: { html: "&#9822;", character: '♞' },
    [PAWN]:   { html: "&#9823;", character: '♟' }
  }
}

const SQUARE_COLORS = {
  dark:  "#b58863",
  light: "#f0d9b5"
}

var cache = {}

const COLUMNS = 'abcdefgh';

const FEN_REGEX = /^(?:[pbnbrqk1-8]{1,8}\/){7}[pbnrqk1-8]{1,8} [wb] (?:-|K?Q?k?q?) (?:-|[a-h][36]) \d+ \d+$/i;

class Piece {
  constructor(...args) {
    if (args.length == 1 && /^[kqrbnp]$/i.test(args[0])) {
      this.color = args[0].toUpperCase() == args[0] ? WHITE : BLACK;
      this.type = {
        k: KING, q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT, p: PAWN
      }[args[0].toLowerCase()]
    } else if (args.length == 2) {
      this.color = args[0];
      this.type  = args[1];
    } else throw "wrong number of arguments";
  }
  get letter() {
    let c = 'kqbnrp'.substr([KING, QUEEN, BISHOP, KNIGHT, ROOK, PAWN].findIndex(x => x == this.type), 1);
    return this.color == WHITE ? c.toUpperCase() : c;
  }
  toHTML()   { return UNICODE_CHESS_SYMBOLS[this.color][this.type].html; }
  toString() { return UNICODE_CHESS_SYMBOLS[this.color][this.type].character; }
  SVGXOffset(pieceSize) { return pieceSize*[KING, QUEEN, BISHOP, KNIGHT, ROOK, PAWN].findIndex(x => x == this.type); }
  SVGYOffset(pieceSize) { return pieceSize*+(this.color == WHITE) }
}

const startpos = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

class Square {
  constructor(name) {
    if (/^[a-h][1-8]$/.test(name)) {
      let row    = name.substr(1,1),
        column = name.substr(0, 1);
      this.row = row;
      this.column = column;
      this.name = name;
      this.x = COLUMNS.indexOf(column);
      this.y = 8 - row;
    } else throw `wrong square name ${name}`;
  }
  get left() {
    if (this.column == 'a') throw "there is no square to the left of the first column";
    return new Square(COLUMNS[COLUMNS.indexOf(this.column) - 1] + this.row);
  }
  get right() {
    if (this.column == 'h') throw "there is no square to the right of the last column";
    return new Square(COLUMNS[COLUMNS.indexOf(this.column) + 1] + this.row);
  }
  get up() {
    if (this.row == '8') throw "there is no square above the last row";
    return new Square(this.column + (+this.row + 1).toString());
  }
  get down() {
    if (this.row == '1') throw "there is no square below the first row";
    return new Square(this.column + (+this.row - 1).toString());
  }
  toString() { return this.name; }
}

class Move {
  constructor(position, ...args) {
    if (! position instanceof Position)
      throw "wrong type for position argument";
    this.position = position;
    let from, to;
    switch (args.length) {
      case 1:
        let arg = args.pop();
        if (/^(?:[a-h][1-8]){2}/.test(arg)) {
          let from = new Square(arg.substr(0, 2)),
            to = new Square(arg.substr(2, 2));
        }
        break;
      case 2:
        [from, to] = args;
        if (! (from instanceof Square && to instanceof Square)) 
          throw "wrong argument type";
        break;
      default:
        throw "constructor variant NYI";
    }
    let pseudoLegalMove = 
      Array.from(this.position.pseudoLegalMoves())
      .find(x => (x.from.name+x.to.name) == from.name+to.name);
    if (!pseudoLegalMove) throw "move is not even pseudo legal";
    this.from      = pseudoLegalMove.from;
    this.to        = pseudoLegalMove.to;      
    if (pseudoLegalMove.castling)  this.castling  = pseudoLegalMove.castling;
    if (pseudoLegalMove.enpassant) this.enpassant = pseudoLegalMove.enpassant;
    if (pseudoLegalMove.promote)   this.promote   = pseudoLegalMove.promote;
  }
  get fan() {
    let result = '',
      move = this,
      capture = this.position.pieces.get(this.to.name) || this.enpassant,
      piece   = this.position.pieces.get(this.from.name),
      piecename = piece.type == PAWN ?
      move.from.name.substr(0, 1) :
      U[piece.color][piece.type],
      otherMoves = this.position.legalMoves.filter(
        x => {
          let la = x.la;
          la.substr(2, 2) == this.to.name
            && la.substr(0, 4) !== this.from.name + this.to.name
            && this.position.pieces.get(x.from.name).type == piece.type
        }
      ),
      otherMovesOnTheSameColumn = otherMoves.filter(x => x.la.substr(0, 1) == this.from.name.substr(0, 1)),
      otherMovesOnTheSameRow    = otherMoves.filter(x => x.la.substr(1, 1) == this.from.name.substr(1, 1)),
      disambiguation;
    if (otherMoves.length > 0) {
      console.warn("disambiguation is needed");
      if (otherMovesOnTheSameColumn.length == 0)
        disambiguation = this.from.name.substr(0, 1);
      else if (otherMovesOnTheSameRow.length == 0)
        disambiguation = this.from.name.substr(1, 1);
      else
        disambiguation = this.from.name;
    }
    if (piece.type == PAWN) 
      result +=
        (capture ? piecename + (disambiguation ? disambiguation : '') + 'x' : '')
        + this.to.name
        + (this.promote ? '=' + this.promote : '');
    else if (this.castling)
      result += this.castling == SHORT ? 'O-O' : 'O-O-O';
    else
      result += piecename + (disambiguation ? disambiguation : '') + (capture ? 'x' : '') + this.to.name;
    if (this.make().check) result += '+';
    return result;
  }
  get a() {
    let 
    result = '',
      move = this,
      capture = this.position.pieces.get(this.to.name) || this.enpassant,
      piece   = this.position.pieces.get(this.from.name),
      piecename = {
        [KING]: 'K',
        [QUEEN]: 'Q',
        [ROOK]: 'R',
        [BISHOP]: 'B',
        [KNIGHT]: 'N',
        [PAWN]: move.from.name.substr(0,1)
      }[piece.type],
      otherMoves = this.position.legalMoves.filter(
        x => {
          let la = x.la;
          la.substr(2, 2) == this.to.name
            && la.substr(0, 4) !== this.from.name + this.to.name
            && this.position.pieces.get(x.from.name).type == piece.type
        }
      ),
      otherMovesOnTheSameColumn = otherMoves.filter(x => x.la.substr(0, 1) == this.from.name.substr(0, 1)),
      otherMovesOnTheSameRow    = otherMoves.filter(x => x.la.substr(1, 1) == this.from.name.substr(1, 1)),
      disambiguation;
    if (otherMoves.length > 0) {
      console.warn("disambiguation is needed");
      if (otherMovesOnTheSameColumn.length == 0)
        disambiguation = this.from.name.substr(0, 1);
      else if (otherMovesOnTheSameRow.length == 0)
        disambiguation = this.from.name.substr(1, 1);
      else
        disambiguation = this.from.name;
    }
    if (piece.type == PAWN) 
      result +=
        (capture ? piecename + (disambiguation ? disambiguation : '') + 'x' : '')
        + this.to.name
        + (this.promote ? '=' + this.promote : '');
    else if (this.castling)
      result += this.castling == SHORT ? 'O-O' : 'O-O-O';
    else
      result += piecename + (disambiguation ? disambiguation : '') + (capture ? 'x' : '') + this.to.name;
    if (this.make().check) result += '+';
    return result;
  }
  make() {
    let position = this.position.clone;
    position.fiftymovescount++;
    let movedPiece = position.pieces.get(this.from.name),
      otherpiece = position.pieces.get(this.to.name),
      enpassant  = position.enpassant;
    if (otherpiece) {
      if (otherpiece.type == KING) throw "A king cannot be taken";
      position.fiftymovescount = 0;
    }

    if (movedPiece.type == PAWN) {
      position.fiftymovescount = 0;
      if (Math.abs(this.to.y - this.from.y) == 2) {
        let
        direction = position.turn == WHITE ? s => s.up : s => s.down,
          enpassant = direction(this.from);
        for (let step of [s => s.left, s => s.right]) {
          try {
            let otherpiece = position.pieces.get(step(this.to).name);
            if (otherpiece && otherpiece.type == PAWN && otherpiece.color !== position.turn) {
              position.enpassant = enpassant.name;
              break;
            }
          } catch (err) { }
        }
      }
    }
    // CASTLING
    if (this.castling) {
      if (!{
        [SHORT]: { [WHITE]: /K/, [BLACK]: /k/ },
        [LONG]:  { [WHITE]: /Q/, [BLACK]: /q/ }
      }[this.castling][position.turn].test(position.castlingRights))
        throw "castling is not allowed";
      let row = position.turn == WHITE ? '1' : '8',
        columns = this.castling == SHORT ? "efgh" : "edcba";
      position.turn = position.turn == WHITE ? BLACK : WHITE;
      let pseudoLegalMoves = Array.from(position.pseudoLegalMoves());
      if (pseudoLegalMoves.filter(m => m.to.name == columns.substr(1, 1) + row).length > 0)
        throw `square ${columns.substr(1, 1) + row} is attacked, so castling is not allowed`;
      // move the rook
      position.pieces.set(columns.substr(1, 1) + row, position.pieces.get(columns.substr(-1, 1) + row));
      position.pieces.delete(columns.substr(-1, 1) + row);
      position.turn = position.turn == WHITE ? BLACK : WHITE;
    }
    if (position.castlingRights !== '-') {
      switch (movedPiece.type) {
        case KING:
          // the king has moved, mark castling as impossible
          position.castlingRights =
            position.castlingRights.replaceAll(position.turn == WHITE ? /[KQ]/g : /[kq]/g, '');
          break;
        case ROOK:
          // the rook has moved, mark corresponding castling as impossible
          if (/^a/.test(this.from.name))
            position.castlingRights =
              position.castlingRights.replaceAll(position.turn == WHITE ? /Q/g : /q/g, '');
          if (/^h/.test(this.from.name))
            position.castlingRights =
              position.castlingRights.replaceAll(position.turn == WHITE ? /K/g : /k/g, '');
      }
      if (position.castlingRights == '') position.castlingRights = '-'
    }

    if (this.promote) 
      position.pieces.set(this.to.name, new Piece(this.promote));
    else
      position.pieces.set(this.to.name, position.pieces.get(this.from.name));
    position.pieces.delete(this.from.name);
    if (enpassant !== '-') position.pieces.delete(this.enpassant);
    let position2 = new Position(position.FEN);
    if (position2.enpassant !== '-') position2.enpassant = '-';
    if (position2.check) throw "check must be evaded";
    if (enpassant !== '-') position.enpassant = '-';
    position.turn = position.turn == WHITE ? BLACK : WHITE;
    if (position.turn == WHITE) position.movenumber++;
    return position;
  }
  // "la" stands for "long algebraic"
  get la() {
    return this.from.toString() + this.to.toString() + (
	this.promote ? this.promote : ''
	);
  }
}

class Position {
  constructor(FEN = startpos) {
    if (!FEN_REGEX.test(FEN)) throw "wrong FEN format";
    let fields = FEN.split(' '),
      board = fields[0];

    this.turn = fields[1] == 'w' ? WHITE : BLACK;
    this.castlingRights = fields[2];
    this.enpassant = fields[3];
    this.fiftymovescount = +fields[4];
    this.movenumber = +fields[5];

    this.pieces = new Map();
    let [i,j] = [0, 0];
    for (let c of board.split('')) {
      if (c == '/') {
        j++; i = 0;
      } else if (/[1-8]/.test(c)) {
        i+=+c;
      } else {
        this.pieces.set("abcdefgh"[i++] + (8 - j).toString(), new Piece(c));
      }  
    }    
  }
  get clone() { return new Position(this.FEN); }
  *pseudoLegalMoves() {
    const HORIZONTAL_STEPS = [ s => s.left, s => s.right ];
    const VERTICAL_STEPS   = [ s => s.up,   s => s.down  ];
    const BISHOP_STEPS     = [ s => s.up.left, s => s.up.right, s => s.down.left, s => s.down.right ];
    const ROOK_STEPS       = [...HORIZONTAL_STEPS, ...VERTICAL_STEPS];
    const ROYAL_STEPS      = [...ROOK_STEPS, ...BISHOP_STEPS];
    const KNIGHT_STEPS     = [ s => s.up.up.left, s => s.up.up.right, s => s.left.left.up, s => s.left.left.down, s => s.down.down.left, s => s.down.down.right, s => s.right.right.up, s => s.right.right.down ];

    for(let kv of this.pieces) {
      let [square, piece] = kv;
      if (piece.color !== this.turn) continue;
      let from = new Square(square);
      let pieces = this.pieces;
      function* linearMoves(...moves) {
        for (let move of moves) {
          let to = from;
          while (true) {
            try {
              to = move(to);
              let otherpiece = pieces.get(to.name);
              if (otherpiece && otherpiece.color == piece.color)
                throw "blocked";
              yield { from, to }
              if (otherpiece && otherpiece.color !== piece.color)
                throw "capture";
            } catch(err) { break; }
          }
        }
      }
      switch (piece.type) {
        case KING:
          for (let move of ROYAL_STEPS) {
            try {
              let to = move(from),
                otherpiece = this.pieces.get(to.name);
              if (!otherpiece || (otherpiece.color !== piece.color))
                yield { from, to }
            } catch (err) {}
          }
          // CASTLING
          let row = this.turn == WHITE ? '1' : '8';
          if (from.name == 'e'+row) {
            if (!pieces.get('f'+row) && !pieces.get('g'+row))
              yield { from, to: new Square('g'+row), castling: SHORT }
            if (!pieces.get('d'+row) && !pieces.get('c'+row))
              yield { from, to: new Square('c'+row), castling: LONG }
          }
          break;
        case QUEEN:
          for (let move of linearMoves(...ROYAL_STEPS)) yield move;
          break;
        case ROOK:
          for (let move of linearMoves(...ROOK_STEPS)) yield move;
          break;
        case BISHOP:
          for (let move of linearMoves(...BISHOP_STEPS)) yield move;
          break;
        case KNIGHT:
          for (let move of KNIGHT_STEPS) {
            try {
              let to = move(from),
                otherpiece = this.pieces.get(to.name);
              if (!otherpiece || (otherpiece && otherpiece.color !== piece.color))
                yield { from, to }
            } catch (err) {}
          }
          break;
        case PAWN:
          let [direction, secondOrSeventhRow] = 
            piece.color == WHITE ? [s => s.up, /2$/] : [s => s.down, /7$/];
          let to = direction(from);
          if (!this.pieces.get(to.name)) {
            if (
              (piece.color == WHITE && /8$/.test(to.name)) ||
              (piece.color == BLACK && /1$/.test(to.name))
            ) {
              for (let p of ['q', 'n', 'r', 'b'])
                yield { from, to, promote: piece.color == WHITE ? p.toUpperCase() : p }
            }
            else yield { from, to }
            if (secondOrSeventhRow.test(from.name)) {
              to = direction(to);
              if (!this.pieces.get(to.name))
                yield { from, to }
            }
          }
          for (let move of [s => direction(s).left, s => direction(s).right]) {
            try {
              let to = move(from),
                otherPiece = this.pieces.get(to.name);
              if (otherPiece && otherPiece.color !== piece.color) {
                if (
                  (piece.color == WHITE && /8$/.test(to.name)) ||
                  (piece.color == BLACK && /1$/.test(to.name))
                ) {
                  for (let p of ['q', 'n', 'r', 'b'])
                    yield { from, to, promote: piece.color == WHITE ? p.toUpperCase() : p }
                }
                else yield { from, to }
              }
            } catch (err) {}
          }
          // EN PASSANT
          if (this.enpassant !== '-') {
            let to = new Square(this.enpassant);
            if (this.pieces.get(to.name)) throw `en passant square ${to.name} is occupied!?`;
            if ((piece.color == WHITE ? /6$/ : /3$/).test(to.name)) {
              if ((piece.color == WHITE ? /5$/ : /4$/).test(from.name)) {
                if (Math.abs(from.x - to.x) == 1 && Math.abs(from.y - to.y) == 1) {
                  yield { from, to, enpassant: this.turn == WHITE ? to.down : to.up }
                }
              }
            }
          }
          break;
        default: throw "unknown piece";
      }
    }
  }
  get legalMoves() {
    let key = this.FEN;
    if (cache[key]) {
      //console.log(`retrieving legalMoves cache for ${this.FEN}`);
      return cache[key]
        .map(m => new Move(this, new Square(m.substr(0, 2)), new Square(m.substr(2, 2))));
    }
    else {
      console.log('computing legal moves');
      let result = [];
      for (let pseudoMove of this.pseudoLegalMoves()) {
        let move = new Move(this, pseudoMove.from, pseudoMove.to);
        try {
          move.make();
        } catch(err) { continue; }
        result.push(move);
      }
      cache[key] = result.map(m => m.la);
      return result;
    }
  }
  draw() {
    clearBoard(ctx);
    this.pieces.forEach(
      (piece, s) => {
        let square = new Square(s);
        piece.draw(ctx, flip(square.x), flip(square.y));
      }
    );
  }
  get FEN() {
    let board = '';
    for (let k = 0; k<64; k++) {
      let y = Math.floor(k / 8), x = k % 8;
      let p = this.pieces.get("abcdefgh"[x] + (8 - y).toString());
      board += p ? p.letter : '1';
      if (k % 8 == 7 && y !== 7) board += '/';
    }
    return [
      board
      .replaceAll('11', '2')
      .replaceAll('21', '3')
      .replaceAll('22', '4')
      .replaceAll('41', '5')
      .replaceAll('42', '6')
      .replaceAll('43', '7')
      .replaceAll('44', '8'),
      this.turn == WHITE ? 'w' : 'b',
      this.castlingRights,
      this.enpassant,
      this.fiftymovescount,
      this.movenumber
    ].join(' ');
  }
  get check() {
    let position = new Position(this.FEN);
    position.turn = position.turn == WHITE ? BLACK : WHITE;
    for (let move of position.pseudoLegalMoves()) {
      let otherpiece = position.pieces.get(move.to.name);
      if (otherpiece && otherpiece.type == KING && otherpiece.color !== position.turn)
        return true;
    }
    return false;
  }
}

class Chessboard {
  constructor(position) {
  }
  clear(context) {
    const size = Math.min(context.canvas.width, context.canvas.height);
    context.save();
    context.scale(size/8,size/8);
    for (let i=0;i<8;i++)
      for (let j=0;j<8;j++) {
        context.fillStyle = ((i + j)%2 ? SQUARE_COLORS.dark : SQUARE_COLORS.light) 
        context.fillRect(i,j,1,1);
      }
    context.restore();
  }
  draw(context) {
    context.save();
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    let size = Math.min(context.canvas.width, context.canvas.height);
    this.clear(context);
    context.restore();
  }
}
