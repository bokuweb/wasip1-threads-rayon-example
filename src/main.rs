use rayon::{prelude::*, ThreadPoolBuilder};

fn sum_of_squares(input: &[i32]) -> i32 {
    let pool = ThreadPoolBuilder::new().num_threads(4).build().unwrap();
    pool.install(|| {
        input
            .par_iter()
            .map(|&i| {
                // panic!("panic!!!!");
                dbg!(rayon::current_thread_index());
                i * i
            })
            .sum()
    })
}

fn main() {
    let x = sum_of_squares(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    println!("{x}");
}
