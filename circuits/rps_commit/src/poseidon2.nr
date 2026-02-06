// Minimal Poseidon2 sponge wrapper using std::hash::poseidon2_permutation.
// This mirrors the Noir standard library implementation for 2-field inputs.

use std::hash::poseidon2_permutation;

global RATE: u32 = 3;

struct Poseidon2 {
    cache: [Field; 3],
    state: [Field; 4],
    cache_size: u32,
    squeeze_mode: bool,
}

pub fn poseidon2_hash_2(a: Field, b: Field) -> Field {
    let two_pow_64 = 18446744073709551616;
    let iv: Field = 2 * two_pow_64;
    let mut sponge = Poseidon2::new(iv);
    sponge.absorb(a);
    sponge.absorb(b);
    sponge.squeeze()
}

impl Poseidon2 {
    fn new(iv: Field) -> Poseidon2 {
        let mut result = Poseidon2 {
            cache: [0; 3],
            state: [0; 4],
            cache_size: 0,
            squeeze_mode: false,
        };
        result.state[RATE] = iv;
        result
    }

    fn perform_duplex(&mut self) -> [Field; RATE] {
        for i in 0..RATE {
            if i >= self.cache_size {
                self.cache[i] = 0;
            }
        }

        for i in 0..RATE {
            self.state[i] += self.cache[i];
        }
        self.state = poseidon2_permutation(self.state, 4);

        let mut result = [0; RATE];
        for i in 0..RATE {
            result[i] = self.state[i];
        }
        result
    }

    fn absorb(&mut self, input: Field) {
        if (!self.squeeze_mode) & (self.cache_size == RATE) {
            let _ = self.perform_duplex();
            self.cache[0] = input;
            self.cache_size = 1;
        } else if (!self.squeeze_mode) & (self.cache_size != RATE) {
            self.cache[self.cache_size] = input;
            self.cache_size += 1;
        } else if self.squeeze_mode {
            self.cache[0] = input;
            self.cache_size = 1;
            self.squeeze_mode = false;
        }
    }

    fn squeeze(&mut self) -> Field {
        if self.squeeze_mode & (self.cache_size == 0) {
            self.squeeze_mode = false;
            self.cache_size = 0;
        }
        if !self.squeeze_mode {
            let new_output_elements = self.perform_duplex();
            self.squeeze_mode = true;
            for i in 0..RATE {
                self.cache[i] = new_output_elements[i];
            }
            self.cache_size = RATE;
        }

        let result = self.cache[0];
        for i in 1..RATE {
            if i < self.cache_size {
                self.cache[i - 1] = self.cache[i];
            }
        }
        self.cache_size -= 1;
        self.cache[self.cache_size] = 0;
        result
    }
}
