use std::thread;

fn main() {
    let mut x = 10;
    thread::scope(|s| {
        s.spawn(|| {
            // dbg!("why. if you enable this line, this program will be hang with nodejs");
            x += 20;
        });
    });
    println!("{x}");
}
