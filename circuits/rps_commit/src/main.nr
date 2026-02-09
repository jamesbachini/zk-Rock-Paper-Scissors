mod poseidon2;
use poseidon2::poseidon2_hash_2;

fn main(move: u8, salt: Field) -> pub [Field; 2] {
    assert(move <= 2);

    let move_f: Field = move as Field;
    let commitment: Field = poseidon2_hash_2(move_f, salt);

    [commitment, move_f]
}
