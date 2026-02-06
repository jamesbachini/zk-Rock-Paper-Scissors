mod poseidon2;
use poseidon2::poseidon2_hash_2;

fn main(move: u8, salt: Field, session_id: Field) -> pub [Field; 2] {
    assert(move <= 2);

    let move_f: Field = move as Field;
    let inner: Field = poseidon2_hash_2(session_id, move_f);
    let commitment: Field = poseidon2_hash_2(inner, salt);

    [commitment, move_f]
}
