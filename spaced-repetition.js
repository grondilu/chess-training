// intervals in seconds
const intervals = [
    25,         //  25 seconds
    120,        //   2 minutes
    600,        //  10 minutes
    3600,       //   1 hour
    18000,      //   5 hours
    86400,      //   1 day
    432000,     //   5 days
    2160000,    //  25 days
    10800000,   // 125 days
    54000000,   // 625 days
    270000000   //   8 years
].map(x => 1000*x);

function pick(array) { return array[Math.floor(Math.random()*array.length)] }

export class SRS {

    constructor(storage, items) {
	this.storage = storage;
	this.items   = items;
	let now = new Date();

	for (let item of items) {
	    if (!storage.getItem(item))
		storage.setItem(item, JSON.stringify({ score: -1, time: now.getTime() }));
	}
    }

    fail(item) { this.storage.setItem(item, JSON.stringify({ score: 0, time: new Date().getTime() })); }

    pass(item) {
	let record = JSON.parse(this.storage.getItem(item)),
	    score  = record.score;

	this.storage.setItem(item, JSON.stringify({ score: record.score+1, time: new Date().getTime() })); 
    }

    get stats() {
	let storage = this.storage,
	    now     = new Date();
	return {
	    "total number of items": this.items.length,
	    "number of items viewed at least once":
		this.items.filter(item => JSON.parse(this.storage.getItem(item)).score >= 0).length,
	    "number of items due for review":
		this.items.filter(item => { let data = JSON.parse(storage.getItem(item)); return data.score >= 0 && data.time + intervals[data.score] < now.getTime() }).length
	};
    }

    pick() {
	let now = new Date(),
	    storage = this.storage,
            items   = this.items.map(item => ({ item, record: JSON.parse(storage.getItem(item)) })),
	    viewed  = items.filter(x => x.record.score >= 0),
	    due     = viewed.filter(x => now.getTime() > x.record.time + intervals[x.record.score]);

	if (viewed.length == 0) {
	    console.log("no item was viewed before, picking one at random");
	    return items[Math.floor(Math.random()*items.length)].item;
	} else if (due.length == 0) {
	    console.log("no previously viewed item is due to review");
	    let unviewed = items.filter(x => x.record.score < 0);
	    if (unviewed.length == 0) {
		console.log("all items have been viewed but none is due to review");
	    } else {
		console.log("picking one item for first view");
		return unviewed[Math.floor(Math.random()*unviewed.length)].item;
	    }
	} else {
	    console.log("there are items to review, picking the one least recently viewed");
	    return due.reduce((a,b) => a.record.time < b.record.time ? a : b).item;
	}
    }

}

// vi: shiftwidth=4 nu
