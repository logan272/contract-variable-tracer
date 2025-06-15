async function main() {
  console.log('Hello world!');
}

main()
  .then(() => {
    console.log('Done!');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
