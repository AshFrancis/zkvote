
// Generated proof for test scenario:
// secret=123456789, salt=987654321, daoId=1, proposalId=1, voteChoice=1
// commitment=16832421271961222550979173996485995711342823810308835997146707681980704453417 (0x2536d01521137bf7b39e3fd26c1376f456ce46a45993a5d7c3c158a450fd7329)
// nullifier=5760508796108392755529358167294721063592787938597807569861628631651201858128 (0x0cbc551a937e12107e513efd646a4f32eec3f0d2c130532e3516bdd9d4683a50)
// root=17138981085726982929815047770222948937180916992196016628536485002859509881328 (0x25e451cc98d0ff49117b5aee305d896da857c2a74c7084332a510fd03e0299f0)

fn hex_to_bytes<const N: usize>(env: &Env, hex: &str) -> BytesN<N> {
    let bytes = hex::decode(hex).expect("invalid hex");
    assert_eq!(bytes.len(), N, "hex string wrong length");
    BytesN::from_array(env, &bytes.try_into().unwrap())
}

fn hex_str_to_u256(env: &Env, hex: &str) -> U256 {
    let bytes = hex::decode(hex).expect("invalid hex");
    let mut padded = [0u8; 32];
    let start = 32 - bytes.len();
    padded[start..].copy_from_slice(&bytes);
    U256::from_be_bytes(env, &Bytes::from_array(env, &padded))
}

fn get_test_proof(env: &Env) -> voting::Proof {
    voting::Proof {
        a: hex_to_bytes(env, "17914902d31fa910439e470faf766ec6559027c3a42c260547d677a94c0402821ad49431ea650d4e26004739566adaf83776490cc015170a04897a23be4222ca"),
        b: hex_to_bytes(env, "03db58e540e336c2eae7aded3bc15285d633f96fbeec32ebe6b645b1411e07d5196cfcf3e3401a156471889645220d74f4556d3cca92580a74e76111d61d99de207453ae229c1c357d199e020bd8c2d50c6385d8072c49f35cd44343a4881c860ae0b84ba81a4b6be32e1de6e410d51615b07bdaedb4db1d723be2fd3deb947e"),
        c: hex_to_bytes(env, "120af225ff6641afc71f060f008b2a9dc589b8205447ef7ef75e1b71310c0ba71b2ec6e17224ff7ca5271f5b9c99fe56bc0fefee147c341088376d8e2a424d09"),
    }
}

// In your test:
let commitment = hex_str_to_u256(&env, "2536d01521137bf7b39e3fd26c1376f456ce46a45993a5d7c3c158a450fd7329");
let nullifier = hex_str_to_u256(&env, "0cbc551a937e12107e513efd646a4f32eec3f0d2c130532e3516bdd9d4683a50");
let root = hex_str_to_u256(&env, "25e451cc98d0ff49117b5aee305d896da857c2a74c7084332a510fd03e0299f0");
let proof = get_test_proof(&env);

// Register the commitment
tree_client.register_with_caller(&dao_id, &commitment, &member);

// Vote with the proof
voting_client.vote(&dao_id, &proposal_id, &true, &nullifier, &root, &proof);
