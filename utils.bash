

get-stockfish-eval() {
	local fen="$*"
	echo -n "$fen" |
		sha1sum | {
			read sha1 x
			look "$sha1" lichess_db_eval/index
		} | {
			read x offset
			if [[ "$offset" ]]
			then raku -e "given open q{lichess_db_eval/lichess_db_eval.jsonl}.IO { .seek: $offset; put .lines(1); .close }"
			else echo "no offset found for $fen" >&2
			fi
	}
}


function find-outliers() {
	local fen="$*"
	echo -n "$fen" |
		sha1sum | {
		read sha1 x
		>/dev/null look "$sha1" lichess_db_eval/index || echo "$fen (sha1=$sha1) not found!"
	}
}
