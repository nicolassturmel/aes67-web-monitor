
module.exports = class statistics {
    constructor() {
        this.max = 0
        this.min = Number.POSITIVE_INFINITY
        this.global_max = 0
        this.global_min = Number.POSITIVE_INFINITY
        this.count = 0
        this.acc = 0
        this.first_round_ok = 5;
    }
     add(c) {
        this.acc += c
        this.count++
        if(c < this.min) this.min = c
        if(c > this.max) this.max = c
    }
     get(keep) {
        if(this.first_round_ok == 0) {
            if(this.min < this.global_min) this.global_min = this.min
            if(this.max > this.global_max) this.global_max = this.max
        } else {
            this.first_round_ok--;
        }
        let r = {
            mean: (this.count > 0? this.acc/this.count : 0) || 0,
            min: this.min,
            max: this.max,
            min_global: this.global_min,
            max_global: this.global_max
        }
        if(!keep) {
            this.max = 0
            this.min = Number.POSITIVE_INFINITY
            this.acc = 0
            this.count = 0
        }
        return r
    }
     clear() {
        this.first_round_ok = 5;
        this.global_max = 0
        this.global_min = Number.POSITIVE_INFINITY
    }
}