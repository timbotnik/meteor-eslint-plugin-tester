Meteor.startup(() => {
  const foo = {
    thing1: 1,
    thing2: 2
  };


  const {thing1, thing2} = foo;
  console.log(`${thing1} + ${thing2} = ${thing1 + thing2}`);
});
